import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { clientIp, isLocked, recordFailure } from "../_shared/throttle.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[6-9]\d{9}$/;
// Unauthenticated endpoint: at most 5 new companies per IP per hour.
const SIGNUP_RULE = { maxFailures: 5, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 };

function validate(b: Record<string, unknown>): string | null {
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (!text(b.fullName, 100)) return "Enter your full name.";
  if (!text(b.companyName, 120)) return "Enter your company name.";
  if (b.companyAddress !== undefined && b.companyAddress !== null && (typeof b.companyAddress !== "string" || b.companyAddress.length > 300)) {
    return "Company address is too long.";
  }
  if (typeof b.email !== "string" || !EMAIL_PATTERN.test(b.email.trim()) || b.email.length > 254) return "Enter a valid email address.";
  if (typeof b.phone !== "string" || !PHONE_PATTERN.test(b.phone.trim())) return "Enter a valid 10-digit mobile number.";
  if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 72) return "Password must be 8 to 72 characters.";
  return null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const ipKey = `signup:${clientIp(req)}`;
    if (await isLocked(admin, ipKey)) {
      return json({ error: "Too many sign-ups from this network. Please try again later." }, 429);
    }

    const body = await req.json().catch(() => null);
    const invalid = validate(body ?? {});
    if (invalid) return json({ error: invalid }, 400);
    const fullName = body.fullName.trim();
    const email = body.email.trim().toLowerCase();
    const phone = body.phone.trim();
    const companyName = body.companyName.trim();
    const companyAddress = typeof body.companyAddress === "string" ? body.companyAddress.trim() : null;
    const password = body.password;
    // Counted on every attempt that reaches account creation, successful or not.
    await recordFailure(admin, ipKey, SIGNUP_RULE).catch(() => {});

    // Runs entirely with the service role, so no RLS timing races (the
    // previous client-side flow could create the auth account, then hit an
    // RLS check on the very next request before the fresh session was fully
    // recognized, leaving an orphaned auth user forever stuck between
    // "already registered" and "no account data to log into"). Any failure
    // after creating the auth user now rolls it back explicitly instead of
    // leaving that broken half-state behind.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) {
      const message = /already.*registered|already.*exists/i.test(createError.message)
        ? "EMAIL_ALREADY_EXISTS"
        : "Could not create the account. Please check your details and try again.";
      if (message !== "EMAIL_ALREADY_EXISTS") console.error("signup-owner auth:", createError.message);
      return json({ error: message }, 400);
    }

    const uid = created.user.id;

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ company_name: companyName, address: companyAddress, owner_id: uid })
      .select()
      .single();
    if (companyError) {
      console.error("signup-owner company:", companyError.message);
      await admin.auth.admin.deleteUser(uid);
      return json({ error: "Could not create the account. Please try again." }, 500);
    }

    const { data: userRow, error: userError } = await admin
      .from("users")
      .insert({
        id: uid,
        email,
        name: fullName,
        phone,
        role: "owner",
        company_id: company.id,
      })
      .select()
      .single();
    if (userError) {
      await admin.from("companies").delete().eq("id", company.id);
      console.error("signup-owner user:", userError.message);
      await admin.auth.admin.deleteUser(uid);
      return json({ error: "Could not create the account. Please try again." }, 500);
    }

    return json({ user: userRow });
  } catch (err) {
    console.error("signup-owner:", err);
    return json({ error: "Could not create the account. Please try again." }, 500);
  }
});
