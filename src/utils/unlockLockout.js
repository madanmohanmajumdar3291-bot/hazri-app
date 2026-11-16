import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS } from './faceUtils';

// Menu-unlock password attempts survive leaving and re-opening the screen
// (and restarting the app). Up to v1.0.2 they lived in component state, so
// backing out and coming back reset the 3-attempt limit.
const keyFor = (userId) => `hazri.unlockLockout.${userId}`;

export function registerFailure(state, now = Date.now()) {
  const base = state && (!state.lockUntil || state.lockUntil > now) ? state : { attempts: 0, lockUntil: null };
  const attempts = (base.lockUntil && base.lockUntil <= now ? 0 : base.attempts) + 1;
  if (attempts >= MAX_PIN_ATTEMPTS) return { attempts, lockUntil: now + PIN_LOCKOUT_MS };
  return { attempts, lockUntil: null };
}

export function isLockedOut(state, now = Date.now()) {
  return Boolean(state?.lockUntil && state.lockUntil > now);
}

export async function loadLockout(userId) {
  if (!userId) return { attempts: 0, lockUntil: null };
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed) return { attempts: 0, lockUntil: null };
    // An expired lock starts a fresh set of attempts.
    if (parsed.lockUntil && parsed.lockUntil <= Date.now()) return { attempts: 0, lockUntil: null };
    return { attempts: Number(parsed.attempts) || 0, lockUntil: parsed.lockUntil ?? null };
  } catch (_error) {
    return { attempts: 0, lockUntil: null };
  }
}

export async function saveLockout(userId, state) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(state));
  } catch (_error) {
    // best-effort
  }
}

export async function clearLockout(userId) {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch (_error) {
    // best-effort
  }
}
