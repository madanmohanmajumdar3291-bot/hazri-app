import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';

// expo-web-browser needs this called once at module load so a redirect back
// into the app from the Google consent screen actually resolves the pending
// promptAsync() promise instead of leaving it hanging forever.
WebBrowser.maybeCompleteAuthSession();

// Google's OAuth2 endpoints — stable, documented, safe to hardcode (this is
// not something that varies per-project).
const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  // Google requires a client_secret on token requests for "Web application"
  // clients, which must never ship in the APK. This Edge Function adds it
  // server-side and forwards to https://oauth2.googleapis.com/token.
  tokenEndpoint: 'https://ckmqbhrmcdeksauejnlp.supabase.co/functions/v1/google-token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

// drive.file (not the broader "drive" scope) — the app can only see/manage
// files IT creates, never the rest of the user's Drive. Narrower scope also
// means a much lighter Google app-verification requirement.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const SECURE_STORE_KEY = 'google_drive_token';
const LAST_BACKUP_KEY = 'google_drive_last_backup';
// Android can kill the app's JS process while the Google sign-in browser tab
// is open (background memory pressure — separate from, and not fixed by,
// "Unrestricted" battery mode). When that happens, the redirect back into
// the app starts a brand-new JS context that has no memory of the original
// AuthRequest.promptAsync() promise, so that promise never resolves as
// 'success' — it's reported as 'dismiss' even though Google's redirect
// actually worked. To survive that, the PKCE code_verifier is persisted
// BEFORE opening the browser, and a Linking listener (registered once, at
// app root — see registerGoogleAuthRedirectListener()) captures the
// hazri://oauthredirect callback independently of whichever JS context
// happens to be alive when it arrives, storing the resulting code so it can
// be picked up and completed afterwards.
const PENDING_CODE_VERIFIER_KEY = 'google_drive_pending_code_verifier';
const PENDING_AUTH_CODE_KEY = 'google_drive_pending_auth_code';

// One "Web application" type client works for every platform here — the
// https bridge above (not a platform-specific native flow) is what actually
// completes the redirect, so there's no need for separate Android/iOS
// client ids the way a native-SDK-based sign-in would require.
function getClientId() {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!clientId || clientId.startsWith('REPLACE_WITH_REAL_')) {
    throw new Error('Google Drive isn\'t configured yet — missing OAuth client ID.');
  }
  return clientId;
}

// Google's "Web application" OAuth client type (required for this generic
// browser-based flow — the "Android"/"iOS" client types are for a different,
// SDK-based sign-in method and reject this flow outright) will only accept
// a real https:// redirect URI, not the app's own hazri:// scheme directly.
// This Edge Function is a tiny bridge registered with Google instead: it
// immediately forwards the redirect into hazri://oauthredirect, which is
// what the app is actually listening for.
const OAUTH_BRIDGE_URL = 'https://ckmqbhrmcdeksauejnlp.supabase.co/functions/v1/google-oauth-bridge';

function getRedirectUri() {
  return OAUTH_BRIDGE_URL;
}

async function saveToken(tokenResponseConfig) {
  await SecureStore.setItemAsync(SECURE_STORE_KEY, JSON.stringify(tokenResponseConfig));
}

async function loadStoredToken() {
  const raw = await SecureStore.getItemAsync(SECURE_STORE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function isDriveConnected() {
  const token = await loadStoredToken();
  return Boolean(token?.refreshToken);
}

export async function getLastBackupAt() {
  return SecureStore.getItemAsync(LAST_BACKUP_KEY);
}

async function setLastBackupNow() {
  await SecureStore.setItemAsync(LAST_BACKUP_KEY, new Date().toISOString());
}

// Pulls the authorization `code` out of a hazri://oauthredirect?code=...
// deep link URL, if present.
function extractCodeFromUrl(url) {
  if (!url || !url.startsWith('hazri://oauthredirect')) return null;
  try {
    const { queryParams } = Linking.parse(url);
    return queryParams?.code || null;
  } catch (_error) {
    return null;
  }
}

// Registered once at app startup (see App.js). Independent of whatever
// JS context happens to be alive when the Google redirect actually lands —
// this is what lets a sign-in survive Android killing the app's JS process
// while the browser tab was open. Any code it captures is stashed for
// finishPendingGoogleAuth()/connectGoogleDrive() to pick up.
export function registerGoogleAuthRedirectListener() {
  const handleUrl = ({ url }) => {
    const code = extractCodeFromUrl(url);
    if (code) {
      SecureStore.setItemAsync(PENDING_AUTH_CODE_KEY, code).catch(() => {});
    }
  };
  Linking.getInitialURL().then((url) => url && handleUrl({ url })).catch(() => {});
  const subscription = Linking.addEventListener('url', handleUrl);
  return () => subscription.remove();
}

async function exchangeAndSaveCode(clientId, redirectUri, code, codeVerifier) {
  const tokenResponse = await AuthSession.exchangeCodeAsync(
    { clientId, code, redirectUri, extraParams: { code_verifier: codeVerifier } },
    DISCOVERY
  );
  if (!tokenResponse.refreshToken) {
    throw new Error('Google did not grant offline access — try disconnecting and reconnecting.');
  }
  await saveToken(tokenResponse.getRequestConfig());
}

// The ONLY place that ever performs the actual token exchange. Reads the
// pending code + verifier, deletes them from storage FIRST, then exchanges —
// so no matter who calls this (connectGoogleDrive()'s own polling loop, or
// GoogleDriveBackupScreen checking on every focus, or both racing each
// other after the same sign-in), the single-use authorization code can only
// ever be consumed once. A second, losing caller simply finds nothing left
// to do and returns false. (An earlier version let connectGoogleDrive() also
// exchange the code directly in its own 'success' branch — that raced with
// this function and submitted the same code twice, which Google rejected.)
export async function finishPendingGoogleAuth() {
  const [code, codeVerifier] = await Promise.all([
    SecureStore.getItemAsync(PENDING_AUTH_CODE_KEY),
    SecureStore.getItemAsync(PENDING_CODE_VERIFIER_KEY),
  ]);
  if (!code || !codeVerifier) return false;

  await SecureStore.deleteItemAsync(PENDING_AUTH_CODE_KEY);
  await SecureStore.deleteItemAsync(PENDING_CODE_VERIFIER_KEY);

  await exchangeAndSaveCode(getClientId(), getRedirectUri(), code, codeVerifier);
  return true;
}

// Runs the browser-based Google consent flow and stores the resulting
// refresh token. access_type=offline + prompt=consent are Google-specific
// params (not part of the OAuth2 spec) — without them Google only hands
// back a refresh_token the very first time an account ever consents.
export async function connectGoogleDrive() {
  const clientId = getClientId();
  const redirectUri = getRedirectUri();

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  // Persisted BEFORE opening the browser so it survives the app's JS
  // process being killed while the user is in the Google consent screen —
  // see the big comment above PENDING_CODE_VERIFIER_KEY.
  await request.makeAuthUrlAsync(DISCOVERY);
  await SecureStore.setItemAsync(PENDING_CODE_VERIFIER_KEY, request.codeVerifier);
  await SecureStore.deleteItemAsync(PENDING_AUTH_CODE_KEY);

  const result = await request.promptAsync(DISCOVERY);

  if (result.type === 'success') {
    await SecureStore.setItemAsync(PENDING_AUTH_CODE_KEY, result.params.code);
  }

  // Whichever of promptAsync's own result or the independent Linking
  // listener actually captured the code, finishPendingGoogleAuth() is what
  // performs the (single) exchange. Poll briefly in case the redirect landed
  // a moment after promptAsync resolved (or resolved as 'cancel'/'dismiss'
  // even though the redirect did arrive — see the big comment above
  // PENDING_CODE_VERIFIER_KEY).
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await finishPendingGoogleAuth()) {
      return { connected: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error(`Sign-in did not complete (${result.type}) — the app didn't detect coming back from Google. Try again.`);
  }
  throw new Error(`Google sign-in failed (${result.type}). Please try again.`);
}

export async function disconnectGoogleDrive() {
  const stored = await loadStoredToken();
  if (stored?.accessToken) {
    try {
      await AuthSession.revokeAsync({ clientId: getClientId(), token: stored.accessToken }, DISCOVERY);
    } catch (_error) {
      // Revocation failing shouldn't block disconnecting locally — the
      // stored token is being deleted either way.
    }
  }
  await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
  await SecureStore.deleteItemAsync(LAST_BACKUP_KEY);
}

// Returns a live access token, transparently refreshing it first if it's
// expired or close to it. Throws if nothing is connected.
export async function getValidAccessToken() {
  const stored = await loadStoredToken();
  if (!stored?.refreshToken) {
    throw new Error('Google Drive is not connected.');
  }

  const tokenResponse = new AuthSession.TokenResponse(stored);
  if (!tokenResponse.shouldRefresh()) {
    return tokenResponse.accessToken;
  }

  const refreshed = await tokenResponse.refreshAsync({ clientId: getClientId() }, DISCOVERY);
  // Google's refresh grant doesn't always return a new refresh_token —
  // keep the original one if this response didn't include one.
  const merged = { ...refreshed.getRequestConfig(), refreshToken: refreshed.refreshToken ?? stored.refreshToken };
  await saveToken(merged);
  return merged.accessToken;
}

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const BACKUP_FOLDER_NAME = 'Hazri Backups';

async function driveFetch(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google Drive request failed (${response.status}): ${body.slice(0, 200)}`);
  }
  return response.json();
}

// Finds the app's backup folder in the user's Drive, creating it the first
// time. Since the drive.file scope only ever sees files/folders this app
// created, there's no risk of colliding with something the user already had.
async function ensureBackupFolderId(accessToken) {
  const query = encodeURIComponent(
    `name = '${BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const existing = await driveFetch(`${DRIVE_FILES_URL}?q=${query}&fields=files(id,name)`, accessToken);
  if (existing.files?.length > 0) return existing.files[0].id;

  const created = await driveFetch(DRIVE_FILES_URL, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return created.id;
}

// Uploads one file's base64 content as a real spreadsheet file into the
// backup folder. Multipart upload (metadata + content in one request) is
// the simplest Drive upload method for files this small.
async function uploadBase64File(accessToken, folderId, filename, base64Content, mimeType) {
  const boundary = 'hazri-backup-boundary';
  const metadata = { name: filename, parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n${base64Content}\r\n` +
    `--${boundary}--`;

  return driveFetch(DRIVE_UPLOAD_URL, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

// Public entry point used by both the manual "Back up now" button and the
// daily background task. `files` is an array of { filename, base64, mimeType }
// — the actual export content is built by companyBackupService.js so this
// module only knows about Drive, not about the app's data shape.
export async function uploadBackupFiles(files) {
  const accessToken = await getValidAccessToken();
  const folderId = await ensureBackupFolderId(accessToken);
  for (const file of files) {
    await uploadBase64File(accessToken, folderId, file.filename, file.base64, file.mimeType);
  }
  await setLastBackupNow();
}

