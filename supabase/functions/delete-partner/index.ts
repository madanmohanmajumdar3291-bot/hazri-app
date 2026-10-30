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

async function deleteAwsFaceIfAny(companyId: string, faceId: string | null | undefined) {
  if (!faceId) return;
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_REGION") ?? "ap-south-1";
  if (!accessKeyId || !secretAccessKey) return;
  try {
    const rekognition = new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
    await rekognition.send(new DeleteFacesCommand({ CollectionId: `company-${companyId}`, FaceIds: [faceId] }));
  } catch (_err) {
    // Best-effort cleanup only — never block the account deletion over this.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

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
    if (callerError || !caller) {
      return json({ error: "Not authenticated" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRow, error: callerRowError } = await admin
      .from("users")
      .select("company_id, role")
      .eq("id", caller.id)
      .maybeSingle();
    if (callerRowError || !callerRow || callerRow.role !== "owner") {
      return json({ error: "Only the owner can remove partners" }, 403);
    }

    const body = await req.json();
    const { partnerId } = body ?? {};
    if (!partnerId) {
      return json({ error: "Missing partnerId" }, 400);
    }

    const { data: partnerRow, error: partnerRowError } = await admin
      .from("users")
      .select("company_id, role, aws_face_id")
      .eq("id", partnerId)
      .maybeSingle();
    if (
      partnerRowError ||
      !partnerRow ||
      (partnerRow.role !== "partner_edit" && partnerRow.role !== "partner_view") ||
      partnerRow.company_id !== callerRow.company_id
    ) {
      return json({ error: "Partner not found in your company" }, 404);
    }

    const { error: deleteRowError } = await admin.from("users").delete().eq("id", partnerId);
    if (deleteRowError) {
      return json({ error: deleteRowError.message }, 500);
    }

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(partnerId);
    if (deleteAuthError) {
      return json({ error: deleteAuthError.message }, 500);
    }

    // Best-effort — the partner's face otherwise stays indexed in AWS
    // forever even after their whole account is gone everywhere else.
    await deleteAwsFaceIfAny(partnerRow.company_id, partnerRow.aws_face_id);

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
