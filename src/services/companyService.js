import { supabase } from './supabase';

export async function getCompany(companyId) {
  const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateCompanyProfile(companyId, { company_name, address }) {
  const { data, error } = await supabase
    .from('companies')
    .update({ company_name, address })
    .eq('id', companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadCompanyLogo(companyId, localUri) {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = blob.type?.split('/')[1] || 'jpg';
  const path = `${companyId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('company-logos')
    .upload(path, blob, { upsert: true, contentType: blob.type });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('company-logos').getPublicUrl(path);
  // Cache-bust so the new logo shows immediately instead of a stale cached image.
  const logo_url = `${publicUrlData.publicUrl}?t=${Date.now()}`;

  const { data, error } = await supabase
    .from('companies')
    .update({ logo_url })
    .eq('id', companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateNotificationPreferences(companyId, preferences) {
  const { data, error } = await supabase
    .from('companies')
    .update({ notification_preferences: preferences })
    .eq('id', companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

