function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// One shared place to turn a raw attendance row into a display status —
// every screen that shows a status pill (Dashboard, Employees, Attendance
// Records, Manual Attendance, Payroll) should read status through this
// instead of re-deriving it, so this rule applies everywhere consistently.
//
// A check-in with no check-out reads differently depending on whether the
// day is still in progress: for TODAY it's shown as Single Punch (they're
// plausibly still at work and just haven't clocked out yet) so nobody
// currently on shift gets falsely flagged absent. Once the day has passed
// with no checkout ever recorded, there's no ambiguity left — it never got
// completed, so it counts as Absent (the punch time itself is still shown
// wherever records list check-in time, this only changes the status/count).
// An admin can always override either way via Manual Attendance.
export function deriveAttendanceStatus(record) {
  if (!record) return 'absent';
  if (record.status === 'leave') return 'leave';
  if (record.status === 'absent') return 'absent';
  if (record.check_in && !record.check_out) {
    return record.date === todayDateString() ? 'single_punch' : 'absent';
  }
  if (record.is_late) return 'late';
  if (record.check_in || record.status === 'present' || record.status === 'half_day') return 'present';
  return 'absent';
}

// What the status pill on a list row should say. Same as
// deriveAttendanceStatus except a finished day (checked in AND out) reads
// "Checked Out" instead of the plain "Present" tick, so it's obvious at a
// glance that the check-out was recorded. Late/absent/leave/single-punch
// records keep their own status.
export function deriveDisplayStatus(record) {
  const status = deriveAttendanceStatus(record);
  if ((status === 'present' || status === 'late') && record?.check_in && record?.check_out) {
    return 'checked_out';
  }
  return status;
}

export function isManualEntry(record) {
  return record?.marked_by === 'manual';
}

export function isManualCheckout(record) {
  return Boolean(record?.manual_checkout);
}

// ME (Manual Entry/present) / ML (Manual Leave) / MA (Manual Absent) —
// shown alongside the status pill only for records marked by hand instead
// of a face scan, so it's always visible at a glance which records came
// from someone typing them in versus the camera.
export function manualBadgeCode(status) {
  if (status === 'leave') return 'ML';
  if (status === 'absent') return 'MA';
  return 'ME';
}

