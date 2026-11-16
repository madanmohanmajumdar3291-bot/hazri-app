/* global jest, describe, test, expect, beforeEach */
const mockStore = new Map();
let mockFail = false;
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k) => {
    if (mockFail) throw new Error('keystore unavailable');
    return mockStore.has(k) ? mockStore.get(k) : null;
  }),
  setItemAsync: jest.fn(async (k, v) => {
    if (mockFail) throw new Error('keystore unavailable');
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k) => {
    mockStore.delete(k);
  }),
}));
jest.mock('../src/services/errorReporting', () => ({ reportError: jest.fn() }));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { secureSessionStorage, splitIntoChunks, CHUNK_SIZE } = require('../src/services/secureStorage');
const KEY = 'sb-ckmq-auth-token';

beforeEach(async () => {
  mockStore.clear();
  mockFail = false;
  await AsyncStorage.clear();
});

describe('Keystore-backed session storage', () => {
  test('a large session round-trips through several chunks', async () => {
    const session = JSON.stringify({ access_token: 'a'.repeat(5000), refresh_token: 'r' });
    await secureSessionStorage.setItem(KEY, session);
    expect(Number(mockStore.get(`${KEY}.n`))).toBe(Math.ceil(session.length / CHUNK_SIZE));
    expect(await secureSessionStorage.getItem(KEY)).toBe(session);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  test('shrinking a value removes leftover chunks', async () => {
    await secureSessionStorage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 3));
    await secureSessionStorage.setItem(KEY, 'short');
    expect(mockStore.has(`${KEY}.1`)).toBe(false);
    expect(await secureSessionStorage.getItem(KEY)).toBe('short');
  });

  test('a v1.0.x session in AsyncStorage is moved into secure storage', async () => {
    await AsyncStorage.setItem(KEY, '{"legacy":true}');
    expect(await secureSessionStorage.getItem(KEY)).toBe('{"legacy":true}');
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(mockStore.get(`${KEY}.0`)).toBe('{"legacy":true}');
  });

  test('logout removes every chunk', async () => {
    await secureSessionStorage.setItem(KEY, 'y'.repeat(CHUNK_SIZE * 2 + 1));
    await secureSessionStorage.removeItem(KEY);
    expect([...mockStore.keys()]).toEqual([]);
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  test('a torn write reads as signed out instead of a corrupt session', async () => {
    await secureSessionStorage.setItem(KEY, 'z'.repeat(CHUNK_SIZE * 2));
    mockStore.delete(`${KEY}.1`);
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  test('falls back to AsyncStorage if the Keystore fails, and reports it', async () => {
    mockFail = true;
    await secureSessionStorage.setItem(KEY, 'v');
    expect(await AsyncStorage.getItem(KEY)).toBe('v');
    expect(await secureSessionStorage.getItem(KEY)).toBe('v');
    expect(require('../src/services/errorReporting').reportError).toHaveBeenCalled();
  });

  test('splitIntoChunks', () => {
    expect(splitIntoChunks('abcde', 2)).toEqual(['ab', 'cd', 'e']);
    expect(splitIntoChunks('', 2)).toEqual(['']);
  });
});
