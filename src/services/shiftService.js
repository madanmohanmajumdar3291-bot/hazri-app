import { supabase } from './supabase';

export async function hasAnyShift(companyId) {
  const { count, error } = await supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Every company's very first shift, created right after the owner finishes
// face setup — start 9:00 AM (late after a 5-minute grace), end 5:00 PM
// (early departure if leaving more than 5 minutes before that).
export async function createDefaultShift(companyId, overrides = {}) {
  const { data, error } = await supabase
    .from('shifts')
    .insert({
      company_id: companyId,
      shift_code: 'GEN',
      shift_name: 'General Shift',
      start_time: '09:00',
      end_time: '17:00',
      shift_duration: '08:00',
      late_grace_minutes: 5,
      early_departure_grace_minutes: 5,
      is_default: true,
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getDefaultShift(companyId) {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getShifts(companyId) {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('company_id', companyId)
    .order('shift_code', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getShift(shiftId) {
  const { data, error } = await supabase.from('shifts').select('*').eq('id', shiftId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createShift(companyId, shift) {
  const { data, error } = await supabase
    .from('shifts')
    .insert({ ...shift, company_id: companyId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateShift(shiftId, shift) {
  const { data, error } = await supabase
    .from('shifts')
    .update(shift)
    .eq('id', shiftId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteShift(shiftId) {
  const { error } = await supabase.from('shifts').delete().eq('id', shiftId);
  if (error) throw error;
}

export async function assignShiftToEmployee(employeeId, shiftId) {
  const { data, error } = await supabase
    .from('employees')
    .update({ shift_id: shiftId })
    .eq('id', employeeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

