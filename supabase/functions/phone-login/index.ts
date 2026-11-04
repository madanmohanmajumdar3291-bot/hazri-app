import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Login and password reset by phone number, done server-side so the app
// never needs an anonymous "phone -> email" lookup. The old public RPC
// (get_email_for_phone) let anyone harvest account emails from phone
// numbers without a password. Here the email never leaves the server:
//   action "sign-in": returns a Supabase session only if the password is right.
//   action "reset":   sends the reset email and always answers ok, so the
//                     response can't be used to test which phones have accounts.
// verify_jwt is off because callers are not signed in yet.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PHONE_PATTERN = /^[6-9]\d{9}$/;
const GENERIC_LOGIN_ERROR = "Incorrect phone number or password.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { action?: string; phone?: string; password?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const phone = String(body.phone ?? "").trim();
  if (!PHONE_PATTERN.test(phone)) return json({ error: "Enter a valid 10-digit phone number." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const publicClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: row } = await admin.from("users").select("email").eq("phone", phone).limit(1).maybeSingle();
  const email = row?.email as string | undefined;

  if (body.action === "reset") {
    if (email) {
      const { error } = await publicClient.auth.resetPasswordForEmail(email, { redirectTo: body.redirectTo });
      if (error) console.error("phone-login reset:", error.message);
    }
    return json({ ok: true });
  }

  if (body.action === "sign-in") {
    if (!email || !body.password) return json({ error: GENERIC_LOGIN_ERROR }, 401);
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password: body.password });
    if (error || !data.session) {
      const status = error?.status === 429 ? 429 : 401;
      return json({ error: status === 429 ? "Too many attempts. Please wait a few minutes." : GENERIC_LOGIN_ERROR }, status);
    }
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  }

  return json({ error: "Unknown action" }, 400);
});
