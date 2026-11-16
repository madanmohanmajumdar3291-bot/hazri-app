/* global jest, describe, test, expect */
const { createAsyncDb } = require('./helpers/sqlite');

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn(), addEventListener: jest.fn() }));
jest.mock('../src/services/cloudFaceService', () => ({ indexFaceInCloud: jest.fn(), isCloudFaceAvailable: jest.fn() }));
const mockSignOut = jest.fn();
jest.mock('../src/services/supabase', () => ({ supabase: { auth: { signOut: (...a) => mockSignOut(...a) } } }));

describe('logout', () => {
  test('wipes cached face templates but keeps queued attendance', async () => {
    const sqlite = require('expo-sqlite');
    sqlite.openDatabaseAsync.mockResolvedValue(createAsyncDb());
    const db = await require('../src/services/db').getDb();
    await db.runAsync("INSERT INTO employees_cache (id, name, face_embedding, company_id) VALUES ('e', 'Asha', '[1]', 'co')");
    await db.runAsync("INSERT INTO attendance_offline (local_id, employee_id, employee_name, company_id, date, marked_by, created_at) VALUES ('q', 'e', 'Asha', 'co', '2026-11-16', 'face', 'now')");
    mockSignOut.mockResolvedValue({ error: null });
    await require('../src/services/authService').logoutOwner();
    expect(await db.getAllAsync('SELECT * FROM employees_cache')).toHaveLength(0);
    expect(await db.getAllAsync('SELECT * FROM attendance_offline')).toHaveLength(1);
  });

  test('still signs out locally when the network call fails', async () => {
    mockSignOut.mockReset();
    mockSignOut.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ error: null });
    await require('../src/services/authService').logoutOwner();
    expect(mockSignOut).toHaveBeenLastCalledWith({ scope: 'local' });
  });
});

describe('request timeout', () => {
  test('aborts a hung request', async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const realFetch = global.fetch;
    global.fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const { fetchWithTimeout, REQUEST_TIMEOUT_MS } = require('../src/services/http');
    const pending = fetchWithTimeout('https://example.supabase.co/rest/v1/x', {});
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS + 1);
    await expect(pending).rejects.toThrow('aborted');
    global.fetch = realFetch;
    jest.useRealTimers();
  });
});
