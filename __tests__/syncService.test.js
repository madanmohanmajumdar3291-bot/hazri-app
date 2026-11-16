/* global jest, describe, test, expect, beforeEach */
const { createAsyncDb } = require('./helpers/sqlite');

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  addEventListener: jest.fn(() => () => {}),
}));
jest.mock('../src/services/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
    from: jest.fn(() => ({ insert: jest.fn(() => Promise.resolve({ error: null })) })),
  },
}));

let db;
let sync;
let supabase;

async function queue(row) {
  const base = {
    local_id: `l-${Math.random()}`,
    employee_id: 'emp-1',
    employee_name: 'Asha',
    company_id: 'co-1',
    check_in: '2026-11-10T03:40:00.000Z',
    date: '2026-11-10',
    marked_by: 'face',
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    ...row,
  };
  const cols = Object.keys(base);
  await db.runAsync(
    `INSERT INTO attendance_offline (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => base[c])
  );
  return base.local_id;
}
const rowById = async (id) => (await db.getAllAsync('SELECT * FROM attendance_offline WHERE local_id = ?', [id]))[0];

beforeEach(async () => {
  jest.resetModules();
  const sqlite = require('expo-sqlite');
  const fresh = createAsyncDb();
  sqlite.openDatabaseAsync.mockResolvedValue(fresh);
  supabase = require('../src/services/supabase').supabase;
  supabase.rpc.mockReset();
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
  db = await require('../src/services/db').getDb();
  sync = require('../src/services/syncService');
});

describe('offline attendance sync', () => {
  test('concurrent sync calls upload each record once', async () => {
    await queue({ local_id: 'a' });
    supabase.rpc.mockImplementation(() => new Promise((r) => setTimeout(() => r({ data: { id: 'srv-1' }, error: null }), 20)));
    const [r1, r2, r3] = await Promise.all([sync.syncPendingAttendance(), sync.syncPendingAttendance(), sync.syncPendingAttendance()]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect((await rowById('a')).sync_status).toBe('synced');
    expect((await rowById('a')).remote_id).toBe('srv-1');
  });

  test('uses the idempotent RPC with a stable transaction id across retries', async () => {
    await queue({ local_id: 'b' });
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: '503', message: 'unavailable' } });
    await sync.syncPendingAttendance();
    const first = supabase.rpc.mock.calls[0];
    expect(first[0]).toBe('sync_attendance');
    const txn = first[1].p.client_txn_id;
    expect(txn).toMatch(/^[0-9a-f-]{36}$/);

    await db.runAsync('UPDATE attendance_offline SET next_attempt_at = NULL');
    supabase.rpc.mockResolvedValueOnce({ data: { id: 'srv-2' }, error: null });
    await sync.syncPendingAttendance();
    expect(supabase.rpc.mock.calls[1][1].p.client_txn_id).toBe(txn);
    expect((await rowById('b')).sync_status).toBe('synced');
  });

  test('temporary failure keeps the record and backs off', async () => {
    await queue({ local_id: 'c' });
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    await sync.syncPendingAttendance();
    const row = await rowById('c');
    expect(row.sync_status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20 * 1000);
    // Not retried again before the backoff expires.
    await sync.syncPendingAttendance();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  test('permanent error is parked as failed after 3 attempts, never deleted', async () => {
    await queue({ local_id: 'd' });
    supabase.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'row-level security' } });
    for (let i = 0; i < 3; i++) {
      await db.runAsync('UPDATE attendance_offline SET next_attempt_at = NULL');
      await sync.syncPendingAttendance();
    }
    const row = await rowById('d');
    expect(row.sync_status).toBe('failed');
    expect(row.last_error).toContain('42501');
    expect(await sync.getPendingCount()).toBe(1);
    expect(await sync.getFailedCount()).toBe(1);
    await sync.requeueFailedForCompany('co-1');
    expect((await rowById('d')).sync_status).toBe('pending');
  });

  test('network exception leaves the row pending', async () => {
    await queue({ local_id: 'e' });
    supabase.rpc.mockRejectedValue(new TypeError('Network request failed'));
    await sync.syncPendingAttendance();
    expect((await rowById('e')).sync_status).toBe('pending');
  });

  test('does not sync while signed out (would look like an RLS failure)', async () => {
    await queue({ local_id: 'f' });
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    const result = await sync.syncPendingAttendance();
    expect(result.skipped).toBe('signed-out');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('a checkout recorded while the check-in was uploading stays pending', async () => {
    await queue({ local_id: 'g' });
    supabase.rpc.mockImplementation(async () => {
      await db.runAsync("UPDATE attendance_offline SET check_out = '2026-11-10T12:30:00.000Z' WHERE local_id = 'g'");
      return { data: { id: 'srv-g' }, error: null };
    });
    await sync.syncPendingAttendance();
    expect((await rowById('g')).sync_status).toBe('pending');
  });

  test('two same-day records are both sent (server merges), none dropped', async () => {
    await queue({ local_id: 'h1', check_in: '2026-11-10T03:30:00.000Z' });
    await queue({ local_id: 'h2', check_in: '2026-11-10T03:45:00.000Z' });
    supabase.rpc.mockResolvedValue({ data: { id: 'srv-h' }, error: null });
    await sync.syncPendingAttendance();
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect((await rowById('h1')).sync_status).toBe('synced');
    expect((await rowById('h2')).sync_status).toBe('synced');
  });

  test('rows a v1.0.x phone marked dropped are put back in the queue', async () => {
    await db.runAsync("INSERT INTO attendance_offline (local_id, employee_id, employee_name, company_id, date, marked_by, sync_status, created_at) VALUES ('old', 'emp', 'X', 'co-1', '2026-11-01', 'face', 'dropped', '2026-11-01')");
    jest.resetModules();
    const sqlite = require('expo-sqlite');
    sqlite.openDatabaseAsync.mockResolvedValue(db);
    await require('../src/services/db').getDb();
    expect((await rowById('old')).sync_status).toBe('pending');
  });

  test('payload mapping converts SQLite integers to booleans', () => {
    const p = sync.buildSyncPayload({ client_txn_id: 'x', employee_id: 'e', date: 'd', is_outside_geofence: 1, is_early_departure: 0 });
    expect(p.is_outside_geofence).toBe(true);
    expect(p.is_early_departure).toBe(false);
    expect(p.marked_by).toBe('face');
  });

  test('backoff doubles and caps at one hour', () => {
    expect(sync.backoffDelayMs(1)).toBe(30000);
    expect(sync.backoffDelayMs(2)).toBe(60000);
    expect(sync.backoffDelayMs(20)).toBe(3600000);
  });
});
