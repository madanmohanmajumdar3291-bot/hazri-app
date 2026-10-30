import { Platform } from 'react-native';
import { supabase } from './supabase';
import { cosineSimilarity, SIMILARITY_THRESHOLD, euclideanDistance, EUCLIDEAN_MATCH_THRESHOLD } from '../utils/faceUtils';
import { getDb, generateLocalId } from './db';
import { isOnline, syncPendingAttendance } from './syncService';
import { getCurrentPosition, getCompanySites, resolveGeofence, recordLocationPing } from './locationService';
import { hasLocationConsent, startFieldTracking, stopFieldTracking } from './fieldTrackingService';

const isWebPlatform = Platform.OS === 'web';

export async function getCompanyEmployees(companyId) {
  // expo-sqlite's web backend needs SharedArrayBuffer, which requires
  // Cross-Origin-Opener-Policy/Cross-Origin-Embedder-Policy response headers
  // our dev server doesn't set — so on web, skip the local cache entirely and
  // always fetch directly from Supabase (a browser tab isn't a real offline
  // app without a service worker anyway).
  if (isWebPlatform) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, face_embedding, face_embeddings, shift_id, work_mode, location_consent_given_at')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .eq('face_registered', true);
    if (error) throw error;
    return data;
  }

  const db = await getDb();

  try {
    const online = await isOnline();
    if (online) {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, face_embedding, face_embeddings, work_mode, location_consent_given_at')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .eq('face_registered', true);
      if (error) throw error;

      for (const employee of data) {
        await db.runAsync(
          `INSERT INTO employees_cache (id, name, face_embedding, face_embeddings, work_mode, location_consent_given_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, face_embedding = excluded.face_embedding, face_embeddings = excluded.face_embeddings, work_mode = excluded.work_mode, location_consent_given_at = excluded.location_consent_given_at`,
          [
            employee.id,
            employee.name,
            JSON.stringify(employee.face_embedding),
            JSON.stringify(employee.face_embeddings ?? null),
            employee.work_mode ?? 'office',
            employee.location_consent_given_at ?? null,
          ]
        );
      }

      // Prune anyone no longer in the live roster (removed, deactivated, or
      // their face un-registered) — without this, a removed employee's face
      // would keep matching forever on any device that had ever cached them,
      // even while fully offline.
      const currentIds = data.map((employee) => employee.id);
      if (currentIds.length > 0) {
        const placeholders = currentIds.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM employees_cache WHERE id NOT IN (${placeholders})`, currentIds);
      } else {
        await db.runAsync(`DELETE FROM employees_cache`);
      }

      return data;
    }
  } catch (error) {
    // Fall through to the local cache below if the network fetch fails.
  }

  const cached = await db.getAllAsync(
    `SELECT id, name, face_embedding, face_embeddings, work_mode, location_consent_given_at FROM employees_cache`
  );
  return cached.map((row) => ({
    id: row.id,
    name: row.name,
    face_embedding: row.face_embedding ? JSON.parse(row.face_embedding) : null,
    face_embeddings: row.face_embeddings ? JSON.parse(row.face_embeddings) : null,
    work_mode: row.work_mode ?? 'office',
    location_consent_given_at: row.location_consent_given_at ?? null,
  }));
}

// Two employees whose stored embeddings happen to score close to each other
// against a given live face used to mean the "winner" was decided by tiny,
// meaningless score differences — one scan says Manoj, the next says Amit,
// for the exact same face. Picking the single best score is no longer
// enough: the best match also has to be clearly ahead of the runner-up, or
// this returns no match at all (a rejection you can retry) rather than a
// guess (a wrong person's attendance marked — the worse failure mode).
const MIN_MATCH_MARGIN = 0.04; // cosine similarity (native)
const MIN_MATCH_MARGIN_EUCLIDEAN = 0.05; // distance (web)

// Registration used to average 3 captured angles (straight/left/right) into
// one blurred vector — a face that's a decent match from every angle can
// still score worse against that average than against any single real
// sample, which was a real source of the mismatches reported in practice.
// Wherever an employee has multiple stored samples (face_embeddings), score
// against each and keep the BEST one — "max of N" — instead of one lossy
// average. Falls back to the single legacy face_embedding for anyone who
// registered before this existed.
function bestScoreAgainst(liveEmbedding, employee, isWeb) {
  const samples =
    Array.isArray(employee.face_embeddings) && employee.face_embeddings.length > 0
      ? employee.face_embeddings
      : employee.face_embedding
      ? [employee.face_embedding]
      : [];
  if (samples.length === 0) return null;

  let best = isWeb ? Infinity : -Infinity;
  for (const sample of samples) {
    const score = isWeb ? euclideanDistance(liveEmbedding, sample) : cosineSimilarity(liveEmbedding, sample);
    if (isWeb ? score < best : score > best) best = score;
  }
  return best;
}

export function findMatchingEmployee(embedding, employees) {
  const isWeb = Platform.OS === 'web';
  const scored = [];

  for (const employee of employees) {
    const score = bestScoreAgainst(embedding, employee, isWeb);
    if (score === null) continue;
    scored.push({ employee, score });
  }
  if (scored.length === 0) return null;

  // Best first: lowest distance for web, highest similarity for native.
  scored.sort((a, b) => (isWeb ? a.score - b.score : b.score - a.score));
  const [best, runnerUp] = scored;

  const passesThreshold = isWeb ? best.score <= EUCLIDEAN_MATCH_THRESHOLD : best.score >= SIMILARITY_THRESHOLD;
  if (!passesThreshold) return null;

  if (runnerUp) {
    const margin = isWeb ? runnerUp.score - best.score : best.score - runnerUp.score;
    const minMargin = isWeb ? MIN_MATCH_MARGIN_EUCLIDEAN : MIN_MATCH_MARGIN;
    if (margin < minMargin) return null;
  }

  return { employee: best.employee, score: best.score };
}

// new Date().toISOString() converts to UTC — in timezones ahead of UTC
// (e.g. India, UTC+5:30), anything scanned between local midnight and 5:30 AM
// would get grouped under the PREVIOUS day's attendance record. Use local
// date parts instead so "today" always matches the employee's actual day.
function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// A shift's start/end are stored as "HH:MM" strings — build a real Date for
// the given calendar day so it can be compared against an actual timestamp.
function timeOnDate(dateString, hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const d = new Date(`${dateString}T00:00:00`);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// Geofencing is opt-in and best-effort: if location permission isn't
// granted, GPS has no fix, or the company hasn't configured any sites yet,
// attendance still goes through unrestricted rather than blocking a scan.
// Remote/field employees (work_mode: 'remote') are exempt from geofence
// restriction entirely — their position is still logged for the live map
// and movement timeline, it just never marks them "outside" a site.
async function resolveGeofenceForCompany(companyId, employee) {
  try {
    const [position, sites] = await Promise.all([getCurrentPosition(), getCompanySites(companyId)]);
    if (!position) return { position: null, geofence: null };
    if (employee?.work_mode === 'remote') return { position, geofence: null };
    const geofence = resolveGeofence(position, sites);
    return { position, geofence };
  } catch (_error) {
    return { position: null, geofence: null };
  }
}

// Total length of a shift in minutes, handling overnight shifts (e.g.
// 21:00 -> 05:00) by wrapping the end time to the next day when it's not
// after the start time.
function shiftDurationMinutes(shift) {
  if (!shift) return null;
  const start = timeOnDate('2000-01-01', shift.start_time);
  let end = timeOnDate('2000-01-01', shift.end_time);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60000);
  return Math.round((end - start) / 60000);
}

// Anyone who checked in AND out but worked less than half their assigned
// shift's length is marked Half Day automatically — with no shift assigned
// there's nothing to compare against, so it's left as a normal full day.
function computeAutoStatus(shift, durationMinutes) {
  const totalMinutes = shiftDurationMinutes(shift);
  if (!totalMinutes) return null;
  return durationMinutes < totalMinutes / 2 ? 'half_day' : null;
}

async function getShiftForEmployee(employee, companyId) {
  if (employee.shift_id) {
    const { data } = await supabase.from('shifts').select('*').eq('id', employee.shift_id).maybeSingle();
    if (data) return data;
  }
  const { data: defaultShift } = await supabase
    .from('shifts')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle();
  return defaultShift ?? null;
}

// Check-in is fixed to the first scan of the day, but checkout keeps
// updating to whichever scan is the LATEST one — it never locks after the
// second scan. This matters because an early/accidental checkout (someone
// scanning on a quick break, or the face-recognized-too-eagerly case) used
// to freeze that day's hours forever with no way to fix it by scanning
// again; now the real end-of-day scan simply overwrites it.
async function recordAttendanceWeb(employee, companyId, { isKiosk = false } = {}) {
  const today = todayDateString();
  const shift = await getShiftForEmployee(employee, companyId);
  const { position, geofence } = await resolveGeofenceForCompany(companyId, employee);

  const { data: existing, error: fetchError } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fetchError) throw fetchError;

  if (!existing) {
    const now = new Date();
    let isLate = null;
    if (shift) {
      const lateAfter = new Date(timeOnDate(today, shift.start_time).getTime() + shift.late_grace_minutes * 60000);
      isLate = now > lateAfter;
    }

    const { data, error } = await supabase
      .from('attendance')
      .insert({
        employee_id: employee.id,
        employee_name: employee.name,
        company_id: companyId,
        check_in: now.toISOString(),
        date: today,
        marked_by: 'face',
        is_late: isLate,
        site_id: geofence?.site?.id ?? null,
        check_in_lat: position?.latitude ?? null,
        check_in_lng: position?.longitude ?? null,
        is_outside_geofence: geofence ? !geofence.isWithinGeofence : false,
      })
      .select()
      .single();
    if (error) throw error;
    if (position) {
      recordLocationPing({
        employeeId: employee.id,
        companyId,
        position,
        eventType: 'check_in',
        siteId: geofence?.site?.id,
        isWithinGeofence: geofence?.isWithinGeofence,
      }).catch(() => {});
    }
    if (!isKiosk && employee.work_mode === 'remote' && (await hasLocationConsent(employee))) {
      startFieldTracking(employee.id, companyId).catch(() => {});
    }
    return { type: 'check-in', record: data, geofence };
  }

  if (existing.check_in) {
    const now = new Date();
    const checkIn = new Date(existing.check_in);
    const durationMinutes = Math.round((now - checkIn) / 60000);

    let isEarlyDeparture = null;
    let overtimeMinutes = null;
    if (shift) {
      const shiftEnd = timeOnDate(today, shift.end_time);
      const earlyBefore = new Date(shiftEnd.getTime() - shift.early_departure_grace_minutes * 60000);
      isEarlyDeparture = now < earlyBefore;
      // Working past the shift's end time counts as overtime — even if they
      // never clocked out on time in the first place, minutes worked beyond
      // the scheduled end are still overtime, not just "late checkout".
      overtimeMinutes = Math.max(0, Math.round((now.getTime() - shiftEnd.getTime()) / 60000));
    }
    const autoStatus = computeAutoStatus(shift, durationMinutes);

    const { data, error } = await supabase
      .from('attendance')
      .update({
        check_out: now.toISOString(),
        duration_minutes: durationMinutes,
        is_early_departure: isEarlyDeparture,
        overtime_minutes: overtimeMinutes,
        check_out_lat: position?.latitude ?? null,
        check_out_lng: position?.longitude ?? null,
        // Always set explicitly (including back to null) — otherwise a
        // corrected later checkout could never clear a stale Half Day flag
        // an earlier, premature checkout had set.
        status: autoStatus,
        // A face-scan check-out replaces any earlier hand-entered one.
        manual_checkout: false,
        checkout_marked_by_name: null,
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    if (position) {
      recordLocationPing({
        employeeId: employee.id,
        companyId,
        position,
        eventType: 'check_out',
        siteId: geofence?.site?.id,
        isWithinGeofence: geofence?.isWithinGeofence,
      }).catch(() => {});
    }
    if (!isKiosk && employee.work_mode === 'remote') {
      stopFieldTracking(employee.id).catch(() => {});
    }
    return { type: 'check-out', record: data, durationMinutes, geofence };
  }

  return { type: 'already-completed', record: existing };
}

// Offline-first (native only): every face-scan attendance mark is written to
// the local SQLite table first (source of truth for "have they already
// checked in today"), then opportunistically pushed to Supabase if a
// connection is available. If offline, it stays "pending" and
// syncPendingAttendance() picks it up once connectivity returns.
export async function recordAttendance(employee, companyId, { isKiosk = false } = {}) {
  if (isWebPlatform) {
    return recordAttendanceWeb(employee, companyId, { isKiosk });
  }

  const db = await getDb();
  const today = todayDateString();

  const existingRows = await db.getAllAsync(
    `SELECT * FROM attendance_offline WHERE employee_id = ? AND date = ? AND sync_status != 'dropped' ORDER BY created_at DESC LIMIT 1`,
    [employee.id, today]
  );
  const existing = existingRows[0];

  // Best-effort — geofencing shouldn't block an offline scan waiting on GPS,
  // so this resolves quickly or comes back null and the mark still goes in.
  const { position, geofence } = await resolveGeofenceForCompany(companyId, employee);

  let result;

  if (!existing) {
    const now = new Date().toISOString();
    const localId = generateLocalId();
    await db.runAsync(
      `INSERT INTO attendance_offline (local_id, employee_id, employee_name, company_id, check_in, date, marked_by, site_id, check_in_lat, check_in_lng, is_outside_geofence, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'face', ?, ?, ?, ?, 'pending', ?)`,
      [
        localId,
        employee.id,
        employee.name,
        companyId,
        now,
        today,
        geofence?.site?.id ?? null,
        position?.latitude ?? null,
        position?.longitude ?? null,
        geofence ? (geofence.isWithinGeofence ? 0 : 1) : 0,
        now,
      ]
    );
    result = { type: 'check-in', record: { check_in: now }, geofence };
    if (!isKiosk && employee.work_mode === 'remote' && (await hasLocationConsent(employee))) {
      startFieldTracking(employee.id, companyId).catch(() => {});
    }
  } else if (existing.check_in) {
    const now = new Date();
    const checkIn = new Date(existing.check_in);
    const durationMinutes = Math.round((now - checkIn) / 60000);
    const shift = await getShiftForEmployee(employee, companyId).catch(() => null);
    const autoStatus = computeAutoStatus(shift, durationMinutes);

    // This checkout path (real face-scan attendance on the phone) never
    // computed overtime at all — only the web fallback did. Same logic as
    // recordAttendanceWeb: minutes worked past the shift's scheduled end
    // count as overtime, and leaving before the grace window before shift
    // end counts as an early departure.
    let isEarlyDeparture = null;
    let overtimeMinutes = null;
    if (shift) {
      const shiftEnd = timeOnDate(today, shift.end_time);
      const earlyBefore = new Date(shiftEnd.getTime() - shift.early_departure_grace_minutes * 60000);
      isEarlyDeparture = now < earlyBefore;
      overtimeMinutes = Math.max(0, Math.round((now.getTime() - shiftEnd.getTime()) / 60000));
    }

    await db.runAsync(
      `UPDATE attendance_offline SET check_out = ?, duration_minutes = ?, check_out_lat = ?, check_out_lng = ?, status = ?, overtime_minutes = ?, is_early_departure = ?, sync_status = 'pending' WHERE local_id = ?`,
      [
        now.toISOString(),
        durationMinutes,
        position?.latitude ?? null,
        position?.longitude ?? null,
        autoStatus,
        overtimeMinutes,
        isEarlyDeparture === null ? null : isEarlyDeparture ? 1 : 0,
        existing.local_id,
      ]
    );
    result = {
      type: 'check-out',
      record: { check_out: now.toISOString(), status: autoStatus, overtime_minutes: overtimeMinutes },
      durationMinutes,
      geofence,
    };
    if (!isKiosk && employee.work_mode === 'remote') {
      stopFieldTracking(employee.id).catch(() => {});
    }
  } else {
    result = { type: 'already-completed', record: existing };
  }

  if (position) {
    recordLocationPing({
      employeeId: employee.id,
      companyId,
      position,
      eventType: existing ? 'check_out' : 'check_in',
      siteId: geofence?.site?.id,
      isWithinGeofence: geofence?.isWithinGeofence,
    }).catch(() => {});
  }

  isOnline().then((online) => {
    if (online) syncPendingAttendance().catch(() => {});
  });

  return result;
}

// Look up whatever attendance record already exists for one employee on one
// day, so an admin editing it (e.g. someone forgot to face-scan) sees and
// corrects the actual record instead of blindly overwriting it.
export async function getAttendanceForEmployeeDate(employeeId, date) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// "HH:MM" (24-hour, matching the same convention as shift start/end times
// elsewhere in the app) combined with the record's own date into a real
// timestamp — building it from local parts (not UTC) so a time entered for
// "today" doesn't shift to the wrong calendar day for timezones ahead of UTC.
function combineDateAndTime(dateString, hhmm) {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) throw new Error('Enter time as HH:MM in 24-hour format, e.g. 09:30');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error('Enter time as HH:MM in 24-hour format, e.g. 09:30');
  const d = new Date(`${dateString}T00:00:00`);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// Manual check-out: for someone who checked in (by face scan or by hand) but
// never checked out. Records the check-out time an admin types in and works
// out hours worked, overtime and early departure the same way a real
// face-scan check-out does, so payroll and reports treat it identically
// instead of leaving the day as an unresolved single punch.
export async function markManualCheckout({
  employee,
  companyId,
  date,
  checkOutTime,
  note,
  markedByUserId,
  markedByName,
}) {
  const { data: existing, error: fetchError } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('date', date)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing || !existing.check_in) {
    throw new Error('No check-in recorded for this day. Mark them Present with a check-in time first.');
  }

  const checkOut = combineDateAndTime(date, checkOutTime);
  if (!checkOut) throw new Error('Enter the check-out time as HH:MM, e.g. 18:30');

  const checkIn = new Date(existing.check_in);
  if (checkOut <= checkIn) {
    const inLabel = checkIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    throw new Error(`Check-out must be after the check-in time (${inLabel}).`);
  }
  const durationMinutes = Math.round((checkOut - checkIn) / 60000);

  const shift = await getShiftForEmployee(employee, companyId).catch(() => null);
  let isEarlyDeparture = null;
  let overtimeMinutes = null;
  if (shift) {
    const shiftEnd = timeOnDate(date, shift.end_time);
    const earlyBefore = new Date(shiftEnd.getTime() - (shift.early_departure_grace_minutes ?? 0) * 60000);
    isEarlyDeparture = checkOut < earlyBefore;
    overtimeMinutes = Math.max(0, Math.round((checkOut.getTime() - shiftEnd.getTime()) / 60000));
  }

  // Half Day is decided by hours actually worked, like a real check-out; an
  // admin's earlier explicit Present/Half Day mark is otherwise kept.
  const autoStatus = computeAutoStatus(shift, durationMinutes);
  const keptStatus = existing.status === 'present' || existing.status === 'half_day' ? existing.status : null;

  const { data, error } = await supabase
    .from('attendance')
    .update({
      check_out: checkOut.toISOString(),
      duration_minutes: durationMinutes,
      is_early_departure: isEarlyDeparture,
      overtime_minutes: overtimeMinutes,
      status: autoStatus ?? keptStatus,
      note: note ?? existing.note ?? null,
      // The check-in keeps whatever source it had (face scan or manual) —
      // only the check-out is flagged manual, plus who entered it, so the
      // record shows an "MO" (manual out) marker instead of pretending the
      // whole day was typed in by hand.
      manual_checkout: true,
      checkout_marked_by_name: markedByName ?? null,
    })
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// A manual "present"/"half_day" mark is not the end of the story — the
// employee still has to face-scan when they actually leave so a real
// checkout gets recorded. So a check_in timestamp (the moment the owner
// marked them present, or an explicit time they typed in) must be saved
// here — otherwise the later face-scan checkout in recordAttendanceWeb() has
// no valid check_in to compute worked duration from. "Absent" needs no
// check_in at all.
//
// checkInTime/checkOutTime (optional "HH:MM") let an admin correct or fill
// in the actual clock times for someone who forgot to scan, rather than
// only ever stamping "now" — this is what makes this a genuine EDIT of the
// record, not just a status override.
export async function markManualAttendance({
  employee,
  companyId,
  date,
  status,
  note,
  markedByUserId,
  markedByName,
  checkInTime,
  checkOutTime,
}) {
  const { data: existing, error: fetchError } = await supabase
    .from('attendance')
    .select('id, check_in, check_out')
    .eq('employee_id', employee.id)
    .eq('date', date)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const needsCheckIn = status !== 'absent' && status !== 'leave';
  const explicitCheckIn = combineDateAndTime(date, checkInTime);
  const explicitCheckOut = combineDateAndTime(date, checkOutTime);
  if (explicitCheckIn && explicitCheckOut && explicitCheckOut <= explicitCheckIn) {
    throw new Error('Check-out time must be after check-in time.');
  }
  const durationMinutes =
    explicitCheckIn && explicitCheckOut ? Math.round((explicitCheckOut - explicitCheckIn) / 60000) : undefined;

  if (existing) {
    const updates = {
      status,
      note,
      marked_by: 'manual',
      marked_by_user_id: markedByUserId ?? null,
      marked_by_name: markedByName ?? null,
    };
    if (explicitCheckIn) {
      updates.check_in = explicitCheckIn.toISOString();
    } else if (needsCheckIn && !existing.check_in) {
      updates.check_in = new Date().toISOString();
    }
    // The edit screen pre-fills the existing check-out time, so only treat it
    // as a manual check-out when the admin actually typed a different time —
    // re-saving a record whose check-out came from a face scan shouldn't
    // relabel that check-out as manual.
    const sameMinute = (a, b) => Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
    const checkOutChanged =
      explicitCheckOut && (!existing.check_out || !sameMinute(new Date(existing.check_out), explicitCheckOut));
    if (checkOutChanged) {
      updates.check_out = explicitCheckOut.toISOString();
      updates.manual_checkout = true;
      updates.checkout_marked_by_name = markedByName ?? null;
    }
    if (durationMinutes !== undefined) {
      updates.duration_minutes = durationMinutes;
    }
    const { data, error } = await supabase
      .from('attendance')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('attendance')
    .insert({
      employee_id: employee.id,
      employee_name: employee.name,
      company_id: companyId,
      date,
      status,
      note,
      marked_by: 'manual',
      marked_by_user_id: markedByUserId ?? null,
      marked_by_name: markedByName ?? null,
      check_in: explicitCheckIn ? explicitCheckIn.toISOString() : needsCheckIn ? new Date().toISOString() : null,
      check_out: explicitCheckOut ? explicitCheckOut.toISOString() : null,
      duration_minutes: durationMinutes ?? null,
      manual_checkout: Boolean(explicitCheckOut),
      checkout_marked_by_name: explicitCheckOut ? markedByName ?? null : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

