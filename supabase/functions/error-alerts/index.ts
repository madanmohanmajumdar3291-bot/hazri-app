import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildAlertText } from "../_shared/alerts.ts";

// Called every 15 minutes by pg_cron (see migrations/20261117b_error_alerts.sql).
// Sends one WhatsApp message (CallMeBot) summarising crashes and attendance
// that could not be synced. verify_jwt is off; the caller must send the
// shared secret ALERT_CRON_SECRET in x-alert-secret instead.
// Settings (shared secret, phone, CallMeBot key) are read from Supabase
// Vault through get_alert_config(), which only the service role may call.
const WINDOW_MINUTES = 15;

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: config } = await admin.rpc("get_alert_config");
  const secret = config?.alert_cron_secret;
  if (!secret || req.headers.get("x-alert-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  const phone = config?.alert_whatsapp_phone;
  const apikey = config?.alert_callmebot_apikey;
  if (!phone || !apikey || String(apikey).startsWith("__")) {
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

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) }).catch((e) => {
    console.error("error-alerts send:", e?.message);
    return null;
  });
  return Response.json({ sent: Boolean(res?.ok), status: res?.status ?? null });
});
