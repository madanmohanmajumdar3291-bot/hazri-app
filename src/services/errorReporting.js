import { Platform } from 'react-native';

// Crash and error reporting to the client_errors table (insert-only for the
// app; read in the Supabase dashboard). No third-party SDK, so no new
// native module and nothing leaves the existing backend.
//
// Never sent: passwords, tokens, face embeddings, photos, email addresses,
// phone numbers. Everything is scrubbed below before it is queued.

const MAX_REPORTS_PER_SESSION = 30;
const DEDUPE_WINDOW_MS = 60 * 1000;
let sentThisSession = 0;
const recent = new Map();

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|apikey|embedding|face|photo|image|base64|email|phone|aadhaar|id_proof/i;

export function scrubText(value) {
  if (value === null || value === undefined) return value;
  return String(value)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?<!\d)[6-9]\d{9}(?!\d)/g, '[phone]')
    .replace(/(-?\d+\.\d+\s*,\s*){8,}-?\d+\.\d+/g, '[numbers]')
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[blob]');
}

export function scrubContext(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 3) return '[deep]';
  if (Array.isArray(value)) {
    if (value.length > 20 && value.every((v) => typeof v === 'number')) return `[${value.length} numbers]`;
    return value.slice(0, 20).map((v) => scrubContext(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value).slice(0, 30)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrubContext(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return scrubText(value).slice(0, 300);
  return value;
}

function appInfo() {
  let appVersion = null;
  let updateId = null;
  try {
    const Constants = require('expo-constants').default;
    appVersion = Constants?.expoConfig?.version ?? null;
  } catch (_e) {
    // not available
  }
  try {
    const Updates = require('expo-updates');
    updateId = Updates?.updateId ?? null;
  } catch (_e) {
    // not available
  }
  const constants = Platform.constants || {};
  return {
    app_version: appVersion,
    update_id: updateId,
    platform: Platform.OS,
    os_version: String(Platform.Version ?? '').slice(0, 40),
    device_model: [constants.Brand, constants.Model].filter(Boolean).join(' ').slice(0, 80) || null,
  };
}

export function buildReport(error, { isFatal = false, context } = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    ...appInfo(),
    is_fatal: Boolean(isFatal),
    error_name: scrubText(err.name || 'Error').slice(0, 200),
    message: scrubText(err.message || '').slice(0, 1000),
    stack: scrubText(err.stack || '').slice(0, 4000),
    context: context ? scrubContext(context) : null,
  };
}

export function reportError(error, options = {}) {
  try {
    const report = buildReport(error, options);
    const fingerprint = `${report.error_name}:${report.message}`;
    const last = recent.get(fingerprint);
    if (last && Date.now() - last < DEDUPE_WINDOW_MS) return;
    if (sentThisSession >= MAX_REPORTS_PER_SESSION) return;
    recent.set(fingerprint, Date.now());
    sentThisSession++;
    const { supabase } = require('./supabase');
    supabase
      .from('client_errors')
      .insert(report)
      .then(() => {})
      .catch(() => {});
  } catch (_e) {
    // Reporting must never throw into the code that is already failing.
  }
}

let installed = false;
export function installGlobalErrorHandlers() {
  if (installed) return;
  installed = true;
  const errorUtils = global.ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const previous = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, { isFatal });
      if (previous) previous(error, isFatal);
    });
  }
  // Hermes: unhandled promise rejections are otherwise only a yellow box in
  // development and nothing at all in a release build.
  const hermes = global.HermesInternal;
  if (hermes?.enablePromiseRejectionTracker) {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => reportError(rejection, { context: { kind: 'unhandled-rejection' } }),
      onHandled: () => {},
    });
  }
}

export function __resetForTests() {
  sentThisSession = 0;
  recent.clear();
}
