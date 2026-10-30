import { supabase } from './supabase';
import { getEmployees } from './employeeService';
import { deriveAttendanceStatus } from '../utils/attendanceStatus';

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// A calendar-month pay cycle: the 1st through the last day of the month
// `monthDate` falls in, plus the date `payroll_records.month` is stored
// under (always the 1st, so one row per employee per month is enforceable).
export function monthRange(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    start: toDateString(start),
    end: toDateString(end),
    monthKey: toDateString(start),
  };
}

// Computes each employee's attendance summary and overtime pay for the
// month, then upserts one payroll_records row per employee. Re-running this
// for a month you've already generated recalculates the attendance
// numbers and base/overtime figures, but does NOT touch payable_amount for
// rows that were already hand-adjusted — see the upsert's column list.
export async function generatePayroll(companyId, monthDate, generatedBy) {
  const { start, end, monthKey } = monthRange(monthDate);
  const [employees, existing, records] = await Promise.all([
    getEmployees(companyId),
    supabase
      .from('payroll_records')
      .select('employee_id, payable_amount')
      .eq('company_id', companyId)
      .eq('month', monthKey)
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
    supabase
      .from('attendance')
      .select('*')
      .eq('company_id', companyId)
      .gte('date', start)
      .lte('date', end)
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
  ]);

  const existingByEmployee = new Map(existing.map((row) => [row.employee_id, row]));

  const byEmployee = new Map();
  for (const record of records) {
    if (!byEmployee.has(record.employee_id)) byEmployee.set(record.employee_id, []);
    byEmployee.get(record.employee_id).push(record);
  }

  const rows = employees.map((employee) => {
    const empRecords = byEmployee.get(employee.id) ?? [];
    // A day that was checked in but never checked out and never got
    // resolved by an admin is treated as absent by the time payroll runs
    // (see deriveAttendanceStatus) — same rule everywhere, so payroll
    // doesn't pay for a day nobody confirmed was actually worked.
    const daysHalfDay = empRecords.filter((r) => r.status === 'half_day').length;
    const daysLeave = empRecords.filter((r) => r.status === 'leave').length;
    const daysAbsent = empRecords.filter(
      (r) => r.status !== 'half_day' && r.status !== 'leave' && deriveAttendanceStatus(r) === 'absent'
    ).length;
    const daysPresent = empRecords.filter(
      (r) => r.status !== 'half_day' && r.status !== 'leave' && deriveAttendanceStatus(r) !== 'absent'
    ).length;
    const daysLate = empRecords.filter((r) => r.is_late).length;
    const overtimeMinutes = empRecords.reduce((sum, r) => sum + (r.overtime_minutes || 0), 0);

    const baseSalary = Number(employee.monthly_salary) || 0;
    const overtimeRate = Number(employee.overtime_rate) || 0;
    const overtimePay = Math.round((overtimeMinutes / 60) * overtimeRate * 100) / 100;

    // Preserve a previously hand-adjusted payable amount instead of
    // silently overwriting it every time payroll is regenerated for the
    // same month — only a brand-new row gets the computed default.
    const previous = existingByEmployee.get(employee.id);
    const payableAmount = previous ? previous.payable_amount : baseSalary + overtimePay;

    return {
      company_id: companyId,
      employee_id: employee.id,
      month: monthKey,
      base_salary: baseSalary,
      days_present: daysPresent,
      days_absent: daysAbsent,
      days_half_day: daysHalfDay,
      days_leave: daysLeave,
      days_late: daysLate,
      overtime_minutes: overtimeMinutes,
      overtime_pay: overtimePay,
      payable_amount: payableAmount,
      generated_by: generatedBy,
    };
  });

  const { data, error } = await supabase
    .from('payroll_records')
    .upsert(rows, { onConflict: 'employee_id,month' })
    .select();
  if (error) throw error;

  const employeesById = new Map(employees.map((e) => [e.id, e]));
  return data
    .map((row) => ({ ...row, employee: employeesById.get(row.employee_id) }))
    .sort((a, b) => (a.employee?.name ?? '').localeCompare(b.employee?.name ?? ''));
}

export async function getPayroll(companyId, monthDate) {
  const { monthKey } = monthRange(monthDate);
  const [records, employees] = await Promise.all([
    supabase
      .from('payroll_records')
      .select('*')
      .eq('company_id', companyId)
      .eq('month', monthKey)
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
    getEmployees(companyId),
  ]);

  const employeesById = new Map(employees.map((e) => [e.id, e]));
  return records
    .map((row) => ({ ...row, employee: employeesById.get(row.employee_id) }))
    .sort((a, b) => (a.employee?.name ?? '').localeCompare(b.employee?.name ?? ''));
}

// Days where someone checked in but never checked out (forgot to scan on
// the way out, app closed, etc.) — these need a human decision, since only
// the owner knows whether that was really a full day, a half day, or
// something else. Surfaced at payroll time rather than auto-decided.
export async function getIncompleteAttendance(companyId, monthDate) {
  const { start, end } = monthRange(monthDate);
  const { data, error } = await supabase
    .from('attendance')
    .select('*, employees(name)')
    .eq('company_id', companyId)
    .gte('date', start)
    .lte('date', end)
    .not('check_in', 'is', null)
    .is('check_out', null)
    .is('status', null)
    .order('date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function resolveIncompleteAttendance(recordId, status) {
  const { data, error } = await supabase
    .from('attendance')
    .update({ status })
    .eq('id', recordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function approvePayrollRecord(recordId, approverId) {
  const { data, error } = await supabase
    .from('payroll_records')
    .update({ status: 'approved', approved_by: approverId, approved_at: new Date().toISOString() })
    .eq('id', recordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markPayrollPaid(recordId) {
  const { data, error } = await supabase
    .from('payroll_records')
    .update({ status: 'paid' })
    .eq('id', recordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePayrollAmount(recordId, payableAmount, notes) {
  const { data, error } = await supabase
    .from('payroll_records')
    .update({ payable_amount: payableAmount, notes })
    .eq('id', recordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

