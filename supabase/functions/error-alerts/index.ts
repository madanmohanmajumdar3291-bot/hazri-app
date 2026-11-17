import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildAlertText } from "../_shared/alerts.ts";

// Called every 15 minutes by pg_cron (see migrations/20261117b_error_alerts.sql).
// Sends one email (via Resend) summarising crashes and attendance that could
// not be synced. verify_jwt is off; the caller must send the shared secret
// in x-alert-secret instead. Settings (shared secret, recipient address,
// Resend API key) are read from Supabase Vault through get_alert_config(),
// which only the service role may call.
const WINDOW_MINUTES = 15;

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config } = await admin.rpc("get_alert_config");
  const secret = config?.alert_cron_secret;
  if (!secret || req.headers.get("x-alert-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  const to = config?.alert_email;
  const apikey = config?.alert_resend_apikey;
  if (!to || !apikey || String(apikey).startsWith("__") || String(to).startsWith("__")) {
    return Response.json({ sent: false, reason: "not configured" });
  }
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("client_errors")
    .select("created_at,is_fatal,error_name,message,app_version,company_id")
    .gte("created_at", since)
    .limit(500);
  if (error) {
    console.error("error-alerts query:", error.message);
    return Response.json({ sent: false, reason: "query failed" }, { status: 500 });
  }

  const text = buildAlertText(data ?? [], WINDOW_MINUTES);
  if (!text) return Response.json({ sent: false, reason: "nothing critical" });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apikey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Resend's shared test sender works without a verified domain, but only
      // delivers to the address the Resend account was created with.
      from: "Hazri Alerts <onboarding@resend.dev>",
      to: [to],
      subject: text.split("\n")[0],
      text,
    }),
    signal: AbortSignal.timeout(20000),
  }).catch((e) => {
    console.error("error-alerts send:", e?.message);
    return null;
  });
  return Response.json({ sent: Boolean(res?.ok), status: res?.status ?? null });
});
