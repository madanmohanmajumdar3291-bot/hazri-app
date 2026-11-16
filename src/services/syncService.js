import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getDb, generateTxnId } from './db';
import { supabase } from './supabase';
import { reportError } from './errorReporting';

// expo-sqlite's web backend needs SharedArrayBuffer, which requires
// COOP/COEP response headers our dev server doesn't set — on web there is no
// local offline queue at all (attendanceService writes straight to Supabase),
// so these just report "nothing pending" instead of touching getDb().
const isWebPlatform = Platform.OS === 'web';

// Retry schedule for a record the server could not take yet: 30s, 1m, 2m,
// 4m ... capped at 1h. Attendance is never deleted from the phone because
// of an error; a record that keeps failing for a reason retrying cannot fix
// is parked as 'failed' (still on the phone, still counted, re-queued on the
// next sign-in to its company) instead of being retried forever.
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const PERMANENT_AFTER_ATTEMPTS = 3;

// Postgres / PostgREST codes that mean "this exact request will never
// succeed": RLS denied, row refers to a deleted employee, malformed data.
// Everything else (network, timeouts, 5xx, expired JWT, function not yet
// deployed) is treated as temporary.
const PERMANENT_ERROR_CODES = new Set(['42501', '23503', '22P02', '22023', '22007', '22008', '23502', '23514']);

export function backoffDelayMs(attempts) {
  const exp = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(exp, MAX_BACKOFF_MS);
}

export function isPermanentSyncError(error) {
  return Boolean(error?.code && PERMANENT_ERROR_CODES.has(String(error.code)));
}

export function buildSyncPayload(row) {
  const bool = (value) => (value === null || value === undefined ? null : Boolean(value));
  return {
    client_txn_id: row.client_txn_id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    company_id: row.company_id,
    date: row.date,
    check_in: row.check_in || null,
    check_out: row.check_out || null,
    marked_by: row.marked_by || 'face',
    status: row.status || null,
    note: row.note || null,
    site_id: row.site_id || null,
    check_in_lat: row.check_in_lat ?? null,
    check_in_lng: row.check_in_lng ?? null,
    check_out_lat: row.check_out_lat ?? null,
    check_out_lng: row.check_out_lng ?? null,
    is_outside_geofence: bool(row.is_outside_geofence) ?? false,
    overtime_minutes: row.overtime_minutes ?? null,
    is_early_departure: bool(row.is_early_departure),
  };
}

export async function getPendingCount() {
  if (isWebPlatform) return 0;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT COUNT(*) as count FROM attendance_offline WHERE sync_status IN ('pending', 'failed')`
  );
  return rows[0]?.count ?? 0;
}

export async function getFailedCount() {
  if (isWebPlatform) return 0;
  const db = await getDb();
  const rows = await db.getAllAsync(`SELECT COUNT(*) as count FROM attendance_offline WHERE sync_status = 'failed'`);
  return rows[0]?.count ?? 0;
}

export async function getLastSyncedAt() {
  if (isWebPlatform) return null;
  const db = await getDb();
  const rows = await db.getAllAsync(`SELECT value FROM sync_meta WHERE key = 'last_synced_at'`);
  return rows[0]?.value ?? null;
}

async function setLastSyncedAt(iso) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_meta (key, value) VALUES ('last_synced_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [iso]
  );
}

// Called after sign-in: anything parked as 'failed' for this company (e.g.
// it was scanned while another account was signed in) gets another chance.
export async function requeueFailedForCompany(companyId) {
  if (isWebPlatform || !companyId) return;
  const db = await getDb();
  await db.runAsync(
    `UPDATE attendance_offline SET sync_status = 'pending', attempts = 0, next_attempt_at = NULL
     WHERE sync_status = 'failed' AND company_id = ?`,
    [companyId]
  );
}

async function syncOne(db, row) {
  let txnId = row.client_txn_id;
  if (!txnId) {
    // Rows queued by v1.0.x have no transaction id yet. Assign one before the
    // first send so every retry of this row carries the same id.
    txnId = generateTxnId();
    await db.runAsync(`UPDATE attendance_offline SET client_txn_id = ? WHERE local_id = ?`, [txnId, row.local_id]);
  }

  const { data, error } = await supabase.rpc('sync_attendance', { p: buildSyncPayload({ ...row, client_txn_id: txnId }) });

  if (!error) {
    // Only mark synced if nothing changed locally while the request was in
    // flight (e.g. a checkout scanned mid-sync); otherwise leave it pending
    // so the newer state goes up on the next pass.
    await db.runAsync(
      `UPDATE attendance_offline SET sync_status = 'synced', remote_id = ?, attempts = 0, last_error = NULL, next_attempt_at = NULL
       WHERE local_id = ? AND COALESCE(check_out, '') = COALESCE(?, '')`,
      [data?.id ?? row.remote_id ?? null, row.local_id, row.check_out ?? null]
    );
    return true;
  }

  const attempts = (row.attempts ?? 0) + 1;
  const permanent = isPermanentSyncError(error) && attempts >= PERMANENT_AFTER_ATTEMPTS;
  const nextAttemptAt = new Date(Date.now() + backoffDelayMs(attempts)).toISOString();
  await db.runAsync(
    `UPDATE attendance_offline SET attempts = ?, last_error = ?, next_attempt_at = ?, sync_status = ? WHERE local_id = ?`,
    [attempts, `${error.code ?? ''} ${error.message ?? ''}`.trim().slice(0, 300), nextAttemptAt, permanent ? 'failed' : 'pending', row.local_id]
  );
  if (permanent) {
    reportError(new Error(`Attendance sync parked as failed: ${error.code}`), {
      context: { code: error.code, attempts },
    });
  }
  return false;
}

async function runSync() {
  const db = await getDb();

  // Without a session every request goes out as the anonymous role and RLS
  // rejects it, which would wrongly look like a permanent error.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) return { synced: 0, skipped: 'signed-out' };

  const nowIso = new Date().toISOString();
  const pending = await db.getAllAsync(
    `SELECT * FROM attendance_offline
     WHERE sync_status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC`,
    [nowIso]
  );

  // Same-day records from two phones are no longer resolved here by
  // discarding one: each is sent, and the server merges them into one row
  // (earliest check-in, latest check-out) idempotently.
  let syncedCount = 0;
  for (const row of pending) {
    try {
      if (await syncOne(db, row)) syncedCount++;
    } catch (error) {
      // A thrown error (not a returned one) is a network failure inside
      // supabase-js; leave the row pending for the next run.
      console.warn('Attendance sync deferred:', error?.message);
    }
  }

  await setLastSyncedAt(new Date().toISOString());
  return { synced: syncedCount };
}

// One sync at a time. Before v1.1.0 this was started from every scan, every
// network change and every scanner mount concurrently, so two runs could
// read the same pending row and both upload it.
let inFlight = null;
export function syncPendingAttendance() {
  if (isWebPlatform) return Promise.resolve({ synced: 0 });
  if (!inFlight) {
    inFlight = runSync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export async function isOnline() {
  try {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch (_error) {
    return false;
  }
}

export function subscribeToNetwork(onChange) {
  return NetInfo.addEventListener((state) => {
    onChange(Boolean(state.isConnected && state.isInternetReachable !== false));
  });
}
