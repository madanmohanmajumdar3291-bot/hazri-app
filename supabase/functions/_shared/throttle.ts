// Fixed-window failure counter backed by public.login_throttle (service role
// only). Used by phone-login and signup-owner. Fails open on database errors
// so an outage of this table never blocks every login; Supabase Auth's own
// limits still apply behind it.
// deno-lint-ignore-file no-explicit-any
type Admin = any;

export type ThrottleRule = { maxFailures: number; windowMs: number; lockMs: number };

export async function isLocked(admin: Admin, key: string): Promise<number | null> {
  const { data, error } = await admin.from("login_throttle").select("locked_until").eq("key", key).maybeSingle();
  if (error || !data?.locked_until) return null;
  const until = new Date(data.locked_until).getTime();
  return until > Date.now() ? until : null;
}

export async function recordFailure(admin: Admin, key: string, rule: ThrottleRule): Promise<void> {
  const now = Date.now();
  const { data } = await admin.from("login_throttle").select("*").eq("key", key).maybeSingle();
  const windowStart = data ? new Date(data.window_started_at).getTime() : now;
  const inWindow = data && now - windowStart < rule.windowMs;
  const failures = (inWindow ? data.failures : 0) + 1;
  const lockedUntil = failures >= rule.maxFailures ? new Date(now + rule.lockMs).toISOString() : null;
  await admin.from("login_throttle").upsert({
    key,
    failures,
    window_started_at: inWindow ? data.window_started_at : new Date(now).toISOString(),
    locked_until: lockedUntil,
  });
}

export async function clearFailures(admin: Admin, key: string): Promise<void> {
  await admin.from("login_throttle").delete().eq("key", key);
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
