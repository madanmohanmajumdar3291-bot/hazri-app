import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';
import { ROLES } from '../constants/config';
import { indexFaceInCloud, isCloudFaceAvailable } from './cloudFaceService';
import { requeueFailedForCompany } from './syncService';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[6-9]\d{9}$/;

// Login (and password reset) accept EITHER a phone number or an email
// address — managers/partners only ever have an email. Phone numbers are
// resolved server-side by the phone-login edge function, so the app never
// sees (or lets anyone look up) the email behind a phone number.
function parseIdentifier(identifier) {
  const trimmed = identifier.trim();
  if (EMAIL_PATTERN.test(trimmed)) return { email: trimmed.toLowerCase() };
  if (PHONE_PATTERN.test(trimmed)) return { phone: trimmed };
  throw { message: 'Enter a valid email address or 10-digit phone number.' };
}

async function invokePhoneLogin(body) {
  const { data, error } = await supabase.functions.invoke('phone-login', { body });
  if (error) {
    let message = 'Could not reach the server. Please try again.';
    try {
      const errBody = await error.context.json();
      if (errBody?.error) message = errBody.error;
    } catch (_e) {
      // keep the generic message
    }
    throw { message };
  }
  return data;
}

async function signInWithIdentifier(identifier, password) {
  const { email, phone } = parseIdentifier(identifier);
  if (email) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }
  const tokens = await invokePhoneLogin({ action: 'sign-in', phone, password });
  const { data, error } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (error) throw error;
  return data.user;
}

// Runs entirely server-side (service role) via the signup-owner edge
// function — creating the auth account, then the company row, then the
// user row as three separate client-side requests (the old approach) had
// no rollback: if the company/user insert failed for any reason (including
// a race where the fresh session wasn't yet recognized by RLS on the very
// next request), the auth account was permanently created with no data
// behind it — stuck forever between "already registered" and "no account
// to log into." The edge function rolls back cleanly on any failure.
export async function signupOwner({ fullName, email, phone, companyName, companyAddress, password }) {
  const { data, error } = await supabase.functions.invoke('signup-owner', {
    body: { fullName, email, phone, companyName, companyAddress, password },
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

  // The edge function creates the account with the service role, which
  // doesn't hand back a client session — sign in normally right after so
  // this device ends up with a real session, same as any other login.
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const uid = data.user.id;
  await AsyncStorage.setItem('uid', uid);
  await AsyncStorage.setItem('companyId', data.user.company_id);

  return data.user;
}

export async function loginOwner({ identifier, password }) {
  const user = await signInWithIdentifier(identifier, password);

  const uid = user.id;
  const userData = await fetchUserDoc(uid);

  if (!userData) {
    await supabase.auth.signOut();
    throw { message: 'No account found with this phone number or email.' };
  }

  const allowedRoles = [ROLES.OWNER, ROLES.MANAGER, ROLES.PARTNER_EDIT, ROLES.PARTNER_VIEW];
  if (!allowedRoles.includes(userData.role)) {
    await supabase.auth.signOut();
    throw { code: 'app/invalid-role' };
  }

  await AsyncStorage.setItem('uid', uid);
  await AsyncStorage.setItem('companyId', userData.company_id);
  requeueFailedForCompany(userData.company_id).catch(() => {});

  return userData;
}

export async function logoutOwner() {
  // Local sign-out still succeeds when the network is down; the server-side
  // refresh token is revoked when reachable.
  await supabase.auth.signOut().catch(() => supabase.auth.signOut({ scope: 'local' }));
  await AsyncStorage.multiRemove(['uid', 'companyId']);
  // Every employee's face template is cached on the phone for offline
  // matching. It belongs to this company only, so it goes with the session.
  // Queued attendance is kept: it uploads on the next sign-in to its company.
  if (Platform.OS !== 'web') {
    try {
      const { getDb } = require('./db');
      const db = await getDb();
      await db.runAsync(`DELETE FROM employees_cache`);
    } catch (_error) {
      // Cache is also filtered by company on read, so a failure here is not a leak.
    }
  }
}

export async function fetchUserDoc(uid) {
  const { data, error } = await supabase.from('users').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveFaceEmbedding(uid, embedding, photoUri, allEmbeddings) {
  const { data, error } = await supabase
    .from('users')
    .update({
      face_embedding: embedding,
      // All individually captured angle samples, not just their average —
      // matching scores each one and keeps the best ("max of N"), which is
      // more reliable than one blurred vector. Optional so older call sites
      // that only ever had the average still work.
      face_embeddings: allEmbeddings ?? null,
      face_registered: true,
      face_registered_at: new Date().toISOString(),
      // Capture is only reachable after the consent step in CameraCapture.
      face_consent_at: new Date().toISOString(),
    })
    .eq('id', uid)
    .select()
    .single();
  if (error) throw error;

  // Best-effort — same reasoning as employeeService.js's saveEmployeeFace:
  // improves live-match accuracy when online, must never block saving the
  // on-device embedding that keeps Menu Unlock working offline.
  if (photoUri && (await isCloudFaceAvailable())) {
    indexFaceInCloud({ subjectType: 'user', subjectId: uid, photoUri }).catch(() => {});
  }

  return data;
}

export async function skipFaceRegistration(uid) {
  const { data, error } = await supabase
    .from('users')
    .update({ face_registered: false })
    .eq('id', uid)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function incrementFailedFaceAttempts(uid, count) {
  const { error } = await supabase
    .from('users')
    .update({ failed_face_attempts: count })
    .eq('id', uid);
  if (error) throw error;
}

export async function requestPasswordReset(identifier) {
  const { email, phone } = parseIdentifier(identifier);
  // Native had no redirect URL at all — there was no app deep-link scheme
  // registered, so the reset email had nowhere valid to send the user back
  // into the app; tapping the link just opened Supabase's default page.
  const redirectTo =
    Platform.OS === 'web' ? `${window.location.origin}/reset-password` : Linking.createURL('reset-password');
  if (phone) {
    // The server sends the email to the account's address without revealing it.
    await invokePhoneLogin({ action: 'reset', phone, redirectTo });
    return null;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
  return email;
}

export async function reauthenticateOwner(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return true;
}

export async function changePassword(email, currentPassword, newPassword) {
  // Re-verify the current password first — updateUser() alone would let
  // anyone with a still-open session change the password without proving
  // they know the old one.
  await reauthenticateOwner(email, currentPassword);
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function logoutOtherSessions() {
  // Supabase's "others" scope signs out every session for this user except
  // the one making the call — no admin/service-role access needed.
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw error;
}

