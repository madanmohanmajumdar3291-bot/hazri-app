import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { RekognitionClient, DeleteFacesCommand } from "npm:@aws-sdk/client-rekognition@3";

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

function collectionIdFor(companyId: string) {
  return `company-${companyId}`;
}

function getRekognitionClient() {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_REGION") ?? "ap-south-1";
  if (!accessKeyId || !secretAccessKey) return null;
  return new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

// Called when an employee/user/manager/partner is deleted or a face is
// re-registered — removes the OLD indexed face from AWS Rekognition so
// deleting someone locally doesn't leave their biometric data behind in the
// cloud collection forever. Best-effort: never blocks the caller's own
// delete flow if AWS isn't configured or the call fails.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRow, error: callerRowError } = await admin
      .from("users")
      .select("company_id")
      .eq("id", caller.id)
      .maybeSingle();
    if (callerRowError || !callerRow?.company_id) return json({ error: "Could not resolve caller's company" }, 403);

    const body = await req.json();
    const { faceId } = body ?? {};
    if (!faceId) return json({ success: true, skipped: "no faceId" });

    const rekognition = getRekognitionClient();
    if (!rekognition) return json({ success: true, skipped: "AWS not configured" });

    try {
      await rekognition.send(
        new DeleteFacesCommand({ CollectionId: collectionIdFor(callerRow.company_id), FaceIds: [faceId] })
      );
    } catch (err) {
      // Face/collection already gone is fine — anything else, still don't
      // block whatever local delete triggered this.
      return json({ success: true, warning: String(err?.message ?? err) });
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 500);
  }
});
