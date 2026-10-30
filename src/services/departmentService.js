import { supabase } from './supabase';

export async function getCompanyDepartments(companyId) {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createDepartment({ companyId, name }) {
  const { data, error } = await supabase
    .from('departments')
    .insert({ company_id: companyId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDepartment(departmentId, updates) {
  const { data, error } = await supabase.from('departments').update(updates).eq('id', departmentId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteDepartment(departmentId) {
  const { error } = await supabase.from('departments').update({ is_active: false }).eq('id', departmentId);
  if (error) throw error;
}

