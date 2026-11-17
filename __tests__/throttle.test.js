/* global describe, test, expect */
import { isLocked, recordFailure, clearFailures, clientIp } from '../supabase/functions/_shared/throttle.ts';

// In-memory stand-in for the slice of the supabase-js query builder used.
function fakeAdmin() {
  const rows = new Map();
  return {
    rows,
    from() {
      let key;
      const api = {
        select: () => api,
        eq: (_col, value) => {
          key = value;
          return api;
        },
        maybeSingle: async () => ({ data: rows.get(key) ?? null, error: null }),
        upsert: async (row) => {
          rows.set(row.key, row);
          return { error: null };
        },
        delete: () => ({
          eq: async (_c, value) => {
            rows.delete(value);
            return { error: null };
          },
        }),
      };
      return api;
    },
  };
}
const RULE = { maxFailures: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 };

describe('phone-login throttle', () => {
  test('locks a number after 5 wrong passwords', async () => {
    const admin = fakeAdmin();
    for (let i = 0; i < 4; i++) await recordFailure(admin, 'phone:9876543210', RULE);
    expect(await isLocked(admin, 'phone:9876543210')).toBeNull();
    await recordFailure(admin, 'phone:9876543210', RULE);
    expect(await isLocked(admin, 'phone:9876543210')).toBeGreaterThan(Date.now());
  });

  test('a successful login clears the counter', async () => {
    const admin = fakeAdmin();
    await recordFailure(admin, 'phone:1', RULE);
    await clearFailures(admin, 'phone:1');
    expect(admin.rows.size).toBe(0);
  });

  test('failures outside the window start a new count', async () => {
    const admin = fakeAdmin();
    admin.rows.set('k', { key: 'k', failures: 4, window_started_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(), locked_until: null });
    await recordFailure(admin, 'k', RULE);
    expect(admin.rows.get('k').failures).toBe(1);
    expect(await isLocked(admin, 'k')).toBeNull();
  });

  test('reads the first forwarded IP', () => {
    const req = { headers: { get: () => '203.0.113.5, 10.0.0.1' } };
    expect(clientIp(req)).toBe('203.0.113.5');
  });
});
