import { supabase } from './supabase';
import { indexFaceInCloud, isCloudFaceAvailable } from './cloudFaceService';

// Free plan: the owner can add two Admins (full edit access) and up to three
// Users (view-only + manual attendance marking) at no cost. Anything beyond
// that is a chargeable seat — enforced both here (pre-check) and server-side
// in the create-partner edge function.
export const FREE_ADMIN_LIMIT = 2;
export const FREE_USER_LIMIT = 3;

export async function createPartner({ name, phone, email, password, tier, linked_employee_id }) {
  const { data, error } = await supabase.functions.invoke('create-partner', {
    body: { name, phone, email, password, tier, linked_employee_id },
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
  return data.partner;
}

export async function getPartners(companyId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('company_id', companyId)
    .in('role', ['partner_edit', 'partner_view'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getPartner(partnerId) {
  const { data, error } = await supabase.from('users').select('*').eq('id', partnerId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function savePartnerFace(partnerId, embedding, photoUri, allEmbeddings) {
  const { data, error } = await supabase
    .from('users')
    .update({
      face_embedding: embedding,
      face_embeddings: allEmbeddings ?? null,
      face_registered: true,
      face_registered_at: new Date().toISOString(),
    })
    .eq('id', partnerId)
    .select()
    .single();
  if (error) throw error;

  // Best-effort cloud indexing — see employeeService.js/authService.js.
  if (photoUri && (await isCloudFaceAvailable())) {
    indexFaceInCloud({ subjectType: 'user', subjectId: partnerId, photoUri }).catch(() => {});
    if (data.linked_employee_id) {
      indexFaceInCloud({ subjectType: 'employee', subjectId: data.linked_employee_id, photoUri }).catch(() => {});
    }
  }

  return data;
}

export async function updatePartnerLinkedEmployee(partnerId, employeeId) {
  const { data, error } = await supabase
    .from('users')
    .update({ linked_employee_id: employeeId })
    .eq('id', partnerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removePartner(partnerId) {
  // Like managers, partners are hard-deleted (both the Auth account and the
  // users row) — deleting an Auth account needs the service-role key, so
  // this goes through an edge function rather than a plain client call.
  const { data, error } = await supabase.functions.invoke('delete-partner', {
    body: { partnerId },
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

