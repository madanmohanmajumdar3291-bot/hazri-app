/* global describe, test, expect */
const { registerFailure, isLockedOut, loadLockout, saveLockout, clearLockout } = require('../src/utils/unlockLockout');

describe('menu-unlock password lockout', () => {
  test('locks after 3 failures for 5 minutes', () => {
    const now = 1_000_000;
    let s = { attempts: 0, lockUntil: null };
    s = registerFailure(s, now);
    s = registerFailure(s, now);
    expect(isLockedOut(s, now)).toBe(false);
    s = registerFailure(s, now);
    expect(isLockedOut(s, now)).toBe(true);
    expect(isLockedOut(s, now + 5 * 60 * 1000 + 1)).toBe(false);
  });

  test('survives leaving and re-opening the screen', async () => {
    const locked = { attempts: 3, lockUntil: Date.now() + 60000 };
    await saveLockout('u1', locked);
    expect(isLockedOut(await loadLockout('u1'))).toBe(true);
    await clearLockout('u1');
    expect(await loadLockout('u1')).toEqual({ attempts: 0, lockUntil: null });
  });

  test('an expired lock starts fresh', async () => {
    await saveLockout('u2', { attempts: 3, lockUntil: Date.now() - 1 });
    expect(await loadLockout('u2')).toEqual({ attempts: 0, lockUntil: null });
  });
});
