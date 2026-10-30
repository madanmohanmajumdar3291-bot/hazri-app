import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Google's "Web application" OAuth client requires a client_secret on every
// token request (code exchange AND refresh), even with PKCE. The secret must
// never ship inside the APK, so the app points expo-auth-session's
// tokenEndpoint here instead of at Google: this function adds the secret
// server-side and forwards the request unchanged to Google's token endpoint.
// Deploy with verify_jwt off: expo-auth-session sends a plain OAuth form post
// with no Supabase session. Access is limited instead by only accepting our
// own client_id and the two grant types the app actually uses.
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ALLOWED_GRANTS = new Set(["authorization_code", "refresh_token"]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json(405, { error: "invalid_request", error_description: "POST only" });
  }

  const clientId = Deno.env.get("GOOGLE_WEB_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("google-token: GOOGLE_WEB_CLIENT_ID or GOOGLE_CLIENT_SECRET secret is not set");
    return json(500, { error: "server_error", error_description: "Google Drive is not configured on the server yet." });
  }

  const params = new URLSearchParams(await req.text());
  const grantType = params.get("grant_type") ?? "";
  if (!ALLOWED_GRANTS.has(grantType)) {
    return json(400, { error: "unsupported_grant_type" });
  }
  if (params.get("client_id") !== clientId) {
    return json(400, { error: "invalid_client" });
  }

  // Never trust a secret sent by the caller; always use ours.
  params.set("client_secret", clientSecret);

  const upstream = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params.toString(),
  });

  const body = await upstream.text();
  if (!upstream.ok) {
    console.warn(`google-token: Google returned ${upstream.status} for ${grantType}`);
  }
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
