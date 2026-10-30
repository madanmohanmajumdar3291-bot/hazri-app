import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  const { data, error } = await supabase
    .from("app_releases")
    .select("apk_url, label, notes, updated_at")
    .eq("id", "latest")
    .maybeSingle();

  if (error || !data?.apk_url) {
    return new Response("No build published yet.", { status: 404 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("info") === "1") {
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: data.apk_url },
  });
});
