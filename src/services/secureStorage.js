import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage adapter for the Supabase session. On Android, expo-secure-store
// encrypts values with a key held in the Android Keystore, so the refresh
// token is no longer a plain file inside the app's data folder (which is how
// it was kept up to v1.0.2, via AsyncStorage).
//
// SecureStore warns above ~2 KB per value and a Supabase session is larger,
// so values are split into chunks: "<key>.n" holds the chunk count and
// "<key>.0", "<key>.1", ... hold the pieces.
//
// Failure mode: if the Keystore is unusable on a device (seen on some
// custom ROMs), this falls back to AsyncStorage rather than locking the
// owner out. That fallback is reported so it can be counted.
export const CHUNK_SIZE = 1800;

let SecureStore = null;
function secureStore() {
  if (Platform.OS === 'web') return null;
  if (SecureStore === null) {
    try {
      SecureStore = require('expo-secure-store');
    } catch (_error) {
      SecureStore = false;
    }
  }
  return SecureStore || null;
}

const countKey = (key) => `${key}.n`;
const chunkKey = (key, index) => `${key}.${index}`;

export function splitIntoChunks(value, size = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks.length ? chunks : [''];
}

async function readSecure(store, key) {
  const countRaw = await store.getItemAsync(countKey(key));
  if (countRaw === null || countRaw === undefined) return null;
  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 1) return null;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const part = await store.getItemAsync(chunkKey(key, i));
    if (part === null || part === undefined) return null; // torn write: treat as signed out
    parts.push(part);
  }
  return parts.join('');
}

async function removeSecure(store, key) {
  const countRaw = await store.getItemAsync(countKey(key));
  const count = Number(countRaw) || 0;
  await store.deleteItemAsync(countKey(key));
  for (let i = 0; i < count; i++) await store.deleteItemAsync(chunkKey(key, i));
}

function onFallback(error) {
  try {
    require('./errorReporting').reportError(error, { context: { area: 'secure-storage-fallback' } });
  } catch (_e) {
    // reporting is best-effort
  }
}

export const secureSessionStorage = {
  async getItem(key) {
    const store = secureStore();
    if (store) {
      try {
        const value = await readSecure(store, key);
        if (value !== null) return value;
        // One-time move of a session saved by v1.0.x in AsyncStorage.
        const legacy = await AsyncStorage.getItem(key);
        if (legacy !== null) {
          await secureSessionStorage.setItem(key, legacy);
          return legacy;
        }
        return null;
      } catch (error) {
        onFallback(error);
      }
    }
    return AsyncStorage.getItem(key);
  },

  async setItem(key, value) {
    const store = secureStore();
    if (store) {
      try {
        const chunks = splitIntoChunks(value);
        const previousCount = Number(await store.getItemAsync(countKey(key))) || 0;
        for (let i = 0; i < chunks.length; i++) await store.setItemAsync(chunkKey(key, i), chunks[i]);
        await store.setItemAsync(countKey(key), String(chunks.length));
        for (let i = chunks.length; i < previousCount; i++) await store.deleteItemAsync(chunkKey(key, i));
        await AsyncStorage.removeItem(key);
        return;
      } catch (error) {
        onFallback(error);
      }
    }
    await AsyncStorage.setItem(key, value);
  },

  async removeItem(key) {
    const store = secureStore();
    if (store) {
      try {
        await removeSecure(store, key);
      } catch (error) {
        onFallback(error);
      }
    }
    await AsyncStorage.removeItem(key);
  },
};
