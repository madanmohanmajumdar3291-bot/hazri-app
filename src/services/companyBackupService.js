import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { getEmployees } from './employeeService';
import { getAttendanceRecords } from './recordsService';
import { getShifts } from './shiftService';
import { getCompanyDepartments } from './departmentService';
import { getCompanySites } from './locationService';
import { uploadBackupFiles } from './googleDriveService';

// One flat sheet per data type — mirrors reportService.js's Excel export
// approach so the output is immediately familiar, just scoped to "the whole
// company" instead of one date range.
function toBase64Workbook(rows, sheetName) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

async function getAllPayrollRecords(companyId) {
  const { data, error } = await supabase
    .from('payroll_records')
    .select('*')
    .eq('company_id', companyId)
    .order('month', { ascending: false });
  if (error) throw error;
  return data;
}

// Every table that's meaningfully "this company's data" — employees,
// attendance, payroll, plus the branch/department/shift setup that gives
// the rest of it context.
export async function buildCompanyBackupFiles(companyId) {
  const [employees, attendance, payroll, shifts, departments, sites] = await Promise.all([
    getEmployees(companyId),
    getAttendanceRecords(companyId),
    getAllPayrollRecords(companyId),
    getShifts(companyId),
    getCompanyDepartments(companyId),
    getCompanySites(companyId),
  ]);

  const dateStamp = new Date().toISOString().slice(0, 10);

  return [
    {
      filename: `Employees_${dateStamp}.xlsx`,
      base64: toBase64Workbook(
        employees.map((e) => ({
          'Employee ID': e.employee_code,
          Name: e.name,
          Phone: e.phone,
          Email: e.email,
          Role: e.role,
          'Work Mode': e.work_mode,
          'Monthly Salary': e.monthly_salary,
          'Face Registered': e.face_registered ? 'Yes' : 'No',
          Active: e.is_active ? 'Yes' : 'No',
          'Date Added': e.created_at,
        })),
        'Employees'
      ),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    {
      filename: `Attendance_${dateStamp}.xlsx`,
      base64: toBase64Workbook(
        attendance.map((a) => ({
          Date: a.date,
          Employee: a.employee_name,
          'Check In': a.check_in,
          'Check Out': a.check_out,
          'Duration (min)': a.duration_minutes,
          Status: a.status,
          Late: a.is_late ? 'Yes' : 'No',
        })),
        'Attendance'
      ),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    {
      filename: `Payroll_${dateStamp}.xlsx`,
      base64: toBase64Workbook(
        payroll.map((p) => ({
          Month: p.month,
          'Employee ID': p.employee_id,
          'Base Salary': p.base_salary,
          'Days Present': p.days_present,
          'Days Absent': p.days_absent,
          'Overtime Pay': p.overtime_pay,
          'Payable Amount': p.payable_amount,
          Status: p.status,
        })),
        'Payroll'
      ),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    {
      filename: `Setup_${dateStamp}.xlsx`,
      base64: (() => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(shifts.map((s) => ({ Name: s.shift_name, Start: s.start_time, End: s.end_time }))),
          'Shifts'
        );
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(departments.map((d) => ({ Name: d.name, Active: d.is_active ? 'Yes' : 'No' }))),
          'Departments'
        );
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(sites.map((s) => ({ Name: s.name, 'Radius (m)': s.radius_meters }))),
          'Branches'
        );
        return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
      })(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  ];
}

export async function backUpCompanyToDrive(companyId) {
  const files = await buildCompanyBackupFiles(companyId);
  await uploadBackupFiles(files);
}
