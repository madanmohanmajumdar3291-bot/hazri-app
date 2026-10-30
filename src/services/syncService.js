import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getDb } from './db';
import { supabase } from './supabase';

// expo-sqlite's web backend needs SharedArrayBuffer, which requires
// COOP/COEP response headers our dev server doesn't set — on web there is no
// local offline queue at all (attendanceService writes straight to Supabase),
// so these just report "nothing pending" instead of touching getDb().
const isWebPlatform = Platform.OS === 'web';

export async function getPendingCount() {
  if (isWebPlatform) return 0;
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT COUNT(*) as count FROM attendance_offline WHERE sync_status = 'pending'`
  );
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

export async function syncPendingAttendance() {
  if (isWebPlatform) return { synced: 0 };
  const db = await getDb();
  const pending = await db.getAllAsync(
    `SELECT * FROM attendance_offline WHERE sync_status = 'pending' ORDER BY created_at ASC`
  );

  if (pending.length === 0) {
    await setLastSyncedAt(new Date().toISOString());
    return { synced: 0 };
  }

  // Conflict resolution: if two pending local records exist for the same
  // employee + date (e.g. marked on two offline devices), keep only the one
  // with the earliest check-in timestamp and drop the other.
  const byKey = new Map();
  for (const row of pending) {
    const key = `${row.employee_id}_${row.date}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, row);
      continue;
    }
    const currentTime = current.check_in ? new Date(current.check_in).getTime() : Infinity;
    const rowTime = row.check_in ? new Date(row.check_in).getTime() : Infinity;
    const keep = rowTime < currentTime ? row : current;
    const drop = keep === row ? current : row;
    console.warn(
      `Attendance conflict for ${key}: keeping local_id=${keep.local_id}, dropping local_id=${drop.local_id}`
    );
    await db.runAsync(`UPDATE attendance_offline SET sync_status = 'dropped' WHERE local_id = ?`, [
      drop.local_id,
    ]);
    byKey.set(key, keep);
  }

  // This was missing entirely — every call below referenced `toSync`
  // without it ever being defined, throwing a ReferenceError on every
  // single sync attempt. Both callers of this function swallow errors
  // (`.catch(() => {})`), so it failed completely silently: offline
  // check-ins queued locally but never actually reached the server, ever.
  const toSync = [...byKey.values()];

  let syncedCount = 0;

  // A row that already has a remote_id was synced once before (as a
  // check-in) and is only "pending" again because a checkout was added
  // locally afterwards — that must UPDATE the existing remote row, never
  // INSERT, or the checkout creates a second, duplicate attendance row
  // while the original check-in-only row is left orphaned forever.
  const toUpdate = toSync.filter((row) => row.remote_id);
  const toInsert = toSync.filter((row) => !row.remote_id);

  for (const row of toUpdate) {
    const { error } = await supabase
      .from('attendance')
      .update({
        check_out: row.check_out || null,
        duration_minutes: row.duration_minutes || null,
        check_out_lat: row.check_out_lat ?? null,
        check_out_lng: row.check_out_lng ?? null,
        status: row.status || null,
        note: row.note || null,
        is_outside_geofence: row.is_outside_geofence ? true : false,
        overtime_minutes: row.overtime_minutes ?? null,
        is_early_departure: row.is_early_departure === null || row.is_early_departure === undefined
          ? null
          : Boolean(row.is_early_departure),
        // Anything recorded locally is a face scan, so it supersedes any
        // check-out an admin typed in by hand.
        manual_checkout: false,
        checkout_marked_by_name: null,
      })
      .eq('id', row.remote_id);
    if (error) {
      console.warn('Sync update failed, will retry on next sync:', error.message);
      continue;
    }
    await db.runAsync(`UPDATE attendance_offline SET sync_status = 'synced' WHERE local_id = ?`, [row.local_id]);
    syncedCount++;
  }

  // Inserted one row at a time (not batched) so the returned row's id maps
  // back to the exact local row unambiguously — a batched insert has no
  // guarantee the response array's order/length matches the request if any
  // single row in the batch is rejected.
  for (const row of toInsert) {
    const payload = {
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      company_id: row.company_id,
      check_in: row.check_in || null,
      check_out: row.check_out || null,
      duration_minutes: row.duration_minutes || null,
      date: row.date,
      marked_by: row.marked_by,
      status: row.status || null,
      note: row.note || null,
      site_id: row.site_id || null,
      check_in_lat: row.check_in_lat ?? null,
      check_in_lng: row.check_in_lng ?? null,
      check_out_lat: row.check_out_lat ?? null,
      check_out_lng: row.check_out_lng ?? null,
      is_outside_geofence: row.is_outside_geofence ? true : false,
      overtime_minutes: row.overtime_minutes ?? null,
      is_early_departure: row.is_early_departure === null || row.is_early_departure === undefined
        ? null
        : Boolean(row.is_early_departure),
    };

    const { data, error } = await supabase.from('attendance').insert(payload).select().single();
    if (error) {
      console.warn('Sync insert failed, will retry on next sync:', error.message);
      continue;
    }
    await db.runAsync(`UPDATE attendance_offline SET sync_status = 'synced', remote_id = ? WHERE local_id = ?`, [
      data.id,
      row.local_id,
    ]);
    syncedCount++;
  }

  await setLastSyncedAt(new Date().toISOString());
  return { synced: syncedCount };
}

export async function isOnline() {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

export function subscribeToNetwork(onChange) {
  return NetInfo.addEventListener((state) => {
    onChange(Boolean(state.isConnected && state.isInternetReachable !== false));
  });
}

