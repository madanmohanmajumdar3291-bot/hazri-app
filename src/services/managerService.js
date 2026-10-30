import { supabase } from './supabase';
import { indexFaceInCloud, isCloudFaceAvailable } from './cloudFaceService';

export const FREE_MANAGER_LIMIT = 3;

export async function createManager({ name, phone, email, password, permissions }) {
  const { data, error } = await supabase.functions.invoke('create-manager', {
    body: { name, phone, email, password, permissions },
  });

  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch (_e) {
      // ignore, fall back to error.message
    }
    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  return data.manager;
}

export async function getManagers(companyId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('company_id', companyId)
    .eq('role', 'manager')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getManager(managerId) {
  const { data, error } = await supabase.from('users').select('*').eq('id', managerId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateManagerPermissions(managerId, permissions) {
  const { data, error } = await supabase
    .from('users')
    .update({ permissions })
    .eq('id', managerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveManagerFace(managerId, embedding, photoUri, allEmbeddings) {
  const { data, error } = await supabase
    .from('users')
    .update({
      face_embedding: embedding,
      face_embeddings: allEmbeddings ?? null,
      face_registered: true,
      face_registered_at: new Date().toISOString(),
    })
    .eq('id', managerId)
    .select()
    .single();
  if (error) throw error;

  // The same face also has to land on the linked `employees` row — that's
  // the table the Home/Kiosk attendance scanner actually matches against,
  // so without this a User account could unlock the Menu but never
  // successfully check themselves in.
  if (data.linked_employee_id) {
    const { error: employeeSyncError } = await supabase
      .from('employees')
      .update({
        face_embedding: embedding,
        face_embeddings: allEmbeddings ?? null,
        face_registered: true,
        face_registered_at: new Date().toISOString(),
      })
      .eq('id', data.linked_employee_id);
    // Surfaced (not swallowed) — if this silently fails (e.g. RLS denies
    // it), the User's Menu Unlock would keep working while their attendance
    // scan silently never matches, with no error to explain why.
    if (employeeSyncError) throw employeeSyncError;
  }

  // Best-effort cloud indexing, mirroring employeeService.js/authService.js
  // — index under both ids, since Menu Unlock searches by user id and the
  // attendance scanner searches by employee id.
  if (photoUri && (await isCloudFaceAvailable())) {
    indexFaceInCloud({ subjectType: 'user', subjectId: managerId, photoUri }).catch(() => {});
    if (data.linked_employee_id) {
      indexFaceInCloud({ subjectType: 'employee', subjectId: data.linked_employee_id, photoUri }).catch(() => {});
    }
  }

  return data;
}

export async function removeManager(managerId) {
  // Unlike employees (soft-deleted to keep attendance history), managers are
  // hard-deleted per spec — both the Auth account and the users row. Deleting
  // an Auth account requires the service-role key, so this goes through an
  // edge function rather than a plain client call.
  const { data, error } = await supabase.functions.invoke('delete-manager', {
    body: { managerId },
  });

  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch (_e) {
      // ignore, fall back to error.message
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
}

