import { supabase } from './supabase';

export async function getLeaveRequests(companyId, { status, employeeId } = {}) {
  let query = supabase
    .from('leave_requests')
    .select('*, employees(name)')
    .eq('company_id', companyId)
    .order('requested_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (employeeId) query = query.eq('employee_id', employeeId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createLeaveRequest({ companyId, employeeId, leaveType, startDate, endDate, reason }) {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function reviewLeaveRequest({ requestId, status, reviewerId, reviewerName, reviewNote, isPaid }) {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote,
      // is_paid is an admin-only decision made at approval time — the
      // employee never chooses this when submitting the request.
      is_paid: status === 'approved' ? Boolean(isPaid) : null,
    })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw error;

  // Approved leave marks the employee's attendance for those dates so it
  // flows into payroll the same way a manual mark would.
  if (status === 'approved') {
    const start = new Date(data.start_date);
    const end = new Date(data.end_date);
    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    const { data: employee } = await supabase.from('employees').select('name').eq('id', data.employee_id).single();
    for (const date of dates) {
      const { data: existing } = await supabase
        .from('attendance')
        .select('id')
        .eq('employee_id', data.employee_id)
        .eq('date', date)
        .maybeSingle();

      const note = `Approved ${data.leave_type} leave (${isPaid ? 'paid' : 'unpaid'})`;
      if (existing) {
        await supabase
          .from('attendance')
          .update({
            status: 'absent',
            marked_by: 'manual',
            marked_by_user_id: reviewerId ?? null,
            marked_by_name: reviewerName ?? null,
            note,
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('attendance').insert({
          employee_id: data.employee_id,
          employee_name: employee?.name ?? '',
          company_id: data.company_id,
          date,
          status: 'absent',
          marked_by: 'manual',
          marked_by_user_id: reviewerId ?? null,
          marked_by_name: reviewerName ?? null,
          note,
        });
      }
    }
  }

  return data;
}

