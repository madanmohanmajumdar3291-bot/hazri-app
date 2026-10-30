import { supabase } from './supabase';
import { getEmployees } from './employeeService';
import { getCompanySites } from './locationService';

// new Date().toISOString() converts to UTC — in timezones ahead of UTC
// (e.g. India, UTC+5:30), "today" between local midnight and 5:30 AM would
// resolve to the PREVIOUS UTC day, so an employee who just checked in could
// still show as absent because their record was grouped under yesterday.
function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getTodaySummary(companyId) {
  const [employees, todayRecords] = await Promise.all([
    getEmployees(companyId),
    supabase
      .from('attendance')
      .select('*')
      .eq('company_id', companyId)
      .eq('date', todayDateString())
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
  ]);

  const recordsByEmployee = new Map();
  for (const record of todayRecords) {
    recordsByEmployee.set(record.employee_id, record);
  }

  let present = 0;
  let absent = 0;
  let checkedIn = 0;
  let checkedOut = 0;
  let late = 0;
  // Additive only — doesn't change what counts as present/checkedIn above,
  // just also flags "checked in, never checked out" separately so it can be
  // shown as its own stat instead of hiding inside "Checked In".
  let singlePunch = 0;

  const statuses = employees.map((employee) => {
    const record = recordsByEmployee.get(employee.id);
    let status = 'absent';

    if (record) {
      if (record.status === 'absent') {
        status = 'absent';
      } else if (record.check_in && record.check_out) {
        status = 'out';
      } else if (record.check_in) {
        status = 'in';
      } else if (record.status === 'present' || record.status === 'half_day') {
        status = 'in';
      }
    }

    if (status === 'in' || status === 'out') present++;
    else absent++;
    if (status === 'in') checkedIn++;
    if (status === 'out') checkedOut++;
    if (record?.is_late) late++;
    if (record?.check_in && !record?.check_out && record.status !== 'absent') singlePunch++;

    return { employee, status, record: record ?? null };
  });

  return {
    present,
    absent,
    checkedIn,
    checkedOut,
    late,
    singlePunch,
    total: employees.length,
    statuses,
  };
}

// Per-branch present/total for today — reuses getTodaySummary's one fetch
// and just groups the result by employee.site_id, so the Home screen's
// branch strip costs nothing extra beyond what Dashboard already fetches.
export async function getBranchAttendanceSummary(companyId) {
  const [sites, summary] = await Promise.all([getCompanySites(companyId), getTodaySummary(companyId)]);
  return sites.map((site) => {
    const siteStatuses = summary.statuses.filter((s) => s.employee.site_id === site.id);
    const present = siteStatuses.filter((s) => s.status === 'in' || s.status === 'out').length;
    return { id: site.id, name: site.name, present, total: siteStatuses.length };
  });
}

export async function getAttendanceRecords(companyId, { employeeId, fromDate, toDate } = {}) {
  let query = supabase.from('attendance').select('*').eq('company_id', companyId);
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (fromDate) query = query.gte('date', fromDate);
  if (toDate) query = query.lte('date', toDate);

  const { data, error } = await query.order('date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getEmployeeAttendanceHistory(employeeId) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .order('date', { ascending: false });
  if (error) throw error;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const thisMonthRecords = data.filter((record) => {
    const recordDate = new Date(record.date);
    return recordDate.getMonth() === currentMonth && recordDate.getFullYear() === currentYear;
  });

  const daysPresent = thisMonthRecords.filter(
    (record) => record.check_in || record.status === 'present' || record.status === 'half_day'
  ).length;

  const totalMinutes = thisMonthRecords.reduce((sum, record) => sum + (record.duration_minutes || 0), 0);
  const avgHours = daysPresent > 0 ? (totalMinutes / daysPresent / 60).toFixed(1) : '0.0';
  const totalOvertimeMinutes = thisMonthRecords.reduce((sum, record) => sum + (record.overtime_minutes || 0), 0);

  const daysInMonthSoFar = now.getDate();
  const attendancePercentage =
    daysInMonthSoFar > 0 ? Math.round((daysPresent / daysInMonthSoFar) * 100) : 0;

  return {
    records: data,
    summary: {
      daysPresentThisMonth: daysPresent,
      averageHours: avgHours,
      attendancePercentage,
      overtimeHours: (totalOvertimeMinutes / 60).toFixed(1),
    },
  };
}

export async function getWeeklyAttendanceCounts(companyId) {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(localDateString(d));
  }

  const { data, error } = await supabase
    .from('attendance')
    .select('date, employee_id')
    .eq('company_id', companyId)
    .gte('date', days[0])
    .lte('date', days[days.length - 1]);
  if (error) throw error;

  const counts = days.map((day) => {
    const uniqueEmployees = new Set(data.filter((r) => r.date === day).map((r) => r.employee_id));
    return { date: day, count: uniqueEmployees.size };
  });

  return counts;
}

