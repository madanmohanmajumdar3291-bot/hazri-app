// supabase-js has no request timeout of its own. On a weak connection a
// request could hang indefinitely and, with it, the attendance sync queue
// and any screen awaiting it. Abort after 60s (long enough for a photo
// upload on 2G) so callers get a normal error.
export const REQUEST_TIMEOUT_MS = 60000;

export function fetchWithTimeout(input, init = {}) {
  if (init.signal || typeof AbortController === 'undefined') return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
