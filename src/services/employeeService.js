// See reportService.js — the plain "expo-file-system" import only exposes
// the new File/Directory class API now; readAsStringAsync/EncodingType
// throw at runtime from there. "expo-file-system/legacy" has the real ones.
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { indexFaceInCloud, isCloudFaceAvailable } from './cloudFaceService';

export const FREE_EMPLOYEE_LIMIT = 50;

export async function createEmployee({
  name,
  phone,
  email,
  role,
  monthly_salary,
  overtime_rate,
  work_mode,
  id_proof_type,
  id_proof_number,
  site_id,
  department_id,
}) {
  const { data, error } = await supabase.functions.invoke('create-employee', {
    body: { name, phone, email, role, monthly_salary, overtime_rate, work_mode, id_proof_type, id_proof_number, site_id, department_id },
  });

  if (error) {
    // supabase-js surfaces non-2xx responses as a FunctionsHttpError; the actual
    // JSON error body (e.g. FREE_LIMIT_REACHED) is on error.context.
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

  return data.employee;
}

// Uploads the straight-on capture from face registration as the employee's
// ID photo. Best-effort: a failed upload must never block saving the face
// embedding itself, since that's what actually makes check-in work.
async function uploadEmployeePhoto(employeeId, localUri) {
  try {
    // fetch(uri).blob() is unreliable for local files on native RN (it's
    // what silently produced zero uploads here and for the company-logo
    // feature) — reading the file as base64 via expo-file-system and
    // decoding to an ArrayBuffer is the approach Supabase's own Expo guide
    // recommends specifically because it actually works cross-platform.
    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    const ext = localUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const path = `${employeeId}/photo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('employee-photos')
      .upload(path, decode(base64), { upsert: true, contentType });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from('employee-photos').getPublicUrl(path);
    // Cache-bust so a re-registered photo shows immediately instead of a stale cached image.
    return `${publicUrlData.publicUrl}?t=${Date.now()}`;
  } catch (_error) {
    return null;
  }
}

export async function saveEmployeeFace(employeeId, embedding, photoUri, allEmbeddings) {
  const photo_url = photoUri ? await uploadEmployeePhoto(employeeId, photoUri) : null;

  const { data, error } = await supabase
    .from('employees')
    .update({
      face_embedding: embedding,
      // All individually captured angle samples — matching scores each and
      // keeps the best ("max of N") instead of one blurred average.
      face_embeddings: allEmbeddings ?? null,
      face_registered: true,
      face_registered_at: new Date().toISOString(),
      ...(photo_url ? { photo_url } : {}),
    })
    .eq('id', employeeId)
    .select()
    .single();
  if (error) throw error;

  // Best-effort, same reasoning as the photo upload above: indexing into
  // AWS Rekognition makes matching more accurate when the device is online,
  // but must never block saving the face itself — the on-device embedding
  // just saved above is what keeps check-in working offline.
  if (photoUri && (await isCloudFaceAvailable())) {
    indexFaceInCloud({ subjectType: 'employee', subjectId: employeeId, photoUri }).catch(() => {});
  }

  return data;
}

export async function getEmployees(companyId) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getEmployee(employeeId) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateEmployee(
  employeeId,
  { name, phone, role, monthly_salary, overtime_rate, work_mode, id_proof_type, id_proof_number, site_id, department_id }
) {
  const { data, error } = await supabase
    .from('employees')
    .update({ name, phone, role, monthly_salary, overtime_rate, work_mode, id_proof_type, id_proof_number, site_id, department_id })
    .eq('id', employeeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Permanent, irreversible deletion — the employee row and every record tied
// to it (attendance, payroll, leave requests, location history) are erased
// together via the database's ON DELETE CASCADE foreign keys. There is no
// undo and no trace left once this completes.
//
// Deleting the row alone leaves two things behind that this also cleans up:
// the actual photo file in storage (deleting the row doesn't touch it), and
// — more importantly — the face AWS Rekognition has indexed in its own
// cloud collection, which otherwise survives forever even after the
// employee is gone everywhere else in the app.
export async function removeEmployee(employeeId, companyId) {
  const { data: employee } = await supabase
    .from('employees')
    .select('aws_face_id')
    .eq('id', employeeId)
    .maybeSingle();

  const { error: deleteError } = await supabase.from('employees').delete().eq('id', employeeId);
  if (deleteError) throw deleteError;

  // Best-effort cleanup — never let either of these block the delete that
  // already succeeded above.
  supabase.storage.from('employee-photos').remove([`${employeeId}/photo.jpg`, `${employeeId}/photo.png`]).catch(() => {});
  if (employee?.aws_face_id) {
    supabase.functions.invoke('delete-face', { body: { faceId: employee.aws_face_id } }).catch(() => {});
  }

  const count = await getEmployeeCount(companyId);
  const { error: companyError } = await supabase
    .from('companies')
    .update({ employee_count: Math.max(count - 1, 0) })
    .eq('id', companyId);
  if (companyError) throw companyError;
}

export async function getEmployeeCount(companyId) {
  const { data, error } = await supabase
    .from('companies')
    .select('employee_count')
    .eq('id', companyId)
    .single();
  if (error) throw error;
  return data.employee_count ?? 0;
}

