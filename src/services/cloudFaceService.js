// AWS Rekognition, proxied through Supabase Edge Functions (index-face /
// search-face) so the AWS credentials never touch the device — only used
// when there's a network connection; every caller of this module is
// expected to fall back to the existing on-device matching in faceService.js
// when offline or when a cloud call fails for any reason. This keeps the
// app's offline-first attendance flow intact instead of replacing it.
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { isOnline } from './syncService';

async function photoToBase64(photoUri) {
  return FileSystem.readAsStringAsync(photoUri, { encoding: FileSystem.EncodingType.Base64 });
}

// AWS credentials were never set as Supabase secrets, so every search-face
// call so far has failed with "AWS credentials are not configured" — but
// isCloudFaceAvailable() only checked network connectivity, so every single
// scan tick still paid for a real network round-trip to Supabase (base64
// encode + invoke + wait for the failure) before falling back to on-device
// matching. That's the actual cause of face scanning feeling slow. Once a
// call fails, stop trying for a cooldown window instead of retrying on
// every tick — self-heals automatically once AWS is actually configured,
// without needing another app update.
let cloudUnavailableUntil = 0;
const CLOUD_COOLDOWN_MS = 10 * 60 * 1000;

function markCloudUnavailable() {
  cloudUnavailableUntil = Date.now() + CLOUD_COOLDOWN_MS;
}

export async function isCloudFaceAvailable() {
  if (Date.now() < cloudUnavailableUntil) return false;
  return isOnline();
}

// Called once during face registration (alongside the existing on-device
// embedding, not instead of it) — indexes the same "look straight" photo
// into the company's AWS Rekognition collection.
export async function indexFaceInCloud({ subjectType, subjectId, photoUri }) {
  const imageBase64 = await photoToBase64(photoUri);
  const { data, error } = await supabase.functions.invoke('index-face', {
    body: { subjectType, subjectId, imageBase64 },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch (_e) {
      // fall back to error.message
    }
    markCloudUnavailable();
    throw new Error(message);
  }
  if (data?.error) {
    markCloudUnavailable();
    throw new Error(data.error);
  }
  return data.faceId;
}

// Called on every live scan tick when online — searches the company's
// Rekognition collection for this face and returns the matched
// employee/user id (the ExternalImageId set at index time), or null.
export async function searchFaceInCloud(photoUri) {
  const imageBase64 = await photoToBase64(photoUri);
  const { data, error } = await supabase.functions.invoke('search-face', {
    body: { imageBase64 },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch (_e) {
      // fall back to error.message
    }
    markCloudUnavailable();
    throw new Error(message);
  }
  if (data?.error) {
    markCloudUnavailable();
    throw new Error(data.error);
  }
  if (!data?.matched) return null;
  return { subjectId: data.subjectId, confidence: data.confidence };
}

