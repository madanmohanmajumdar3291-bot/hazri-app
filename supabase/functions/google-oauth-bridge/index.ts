import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Google's "Web application" OAuth client type requires a real https://
// redirect URI — it will not accept a custom app-link scheme like
// hazri://oauthredirect directly. This tiny bridge is what we register with
// Google instead: it receives the redirect (with ?code=...&state=...),
// forwards the exact same query string straight into the app's own
// hazri://oauthredirect deep link, and Android/iOS hands control back to
// Hazri from there. Nothing here ever sees or stores the auth code beyond
// passing it through.
Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const target = `hazri://oauthredirect${url.search}`;
  return new Response(null, {
    status: 302,
    headers: { Location: target },
  });
});
