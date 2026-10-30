import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
} from "npm:@aws-sdk/client-rekognition@3";

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
  // Rekognition collection ids: [a-zA-Z0-9_.-]+ — a UUID already fits.
  return `company-${companyId}`;
}

function getRekognitionClient() {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_REGION") ?? "ap-south-1";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are not configured on this project yet.");
  }
  return new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

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
    const { subjectType, subjectId, imageBase64 } = body ?? {};
    if (!subjectType || !subjectId || !imageBase64) return json({ error: "Missing required fields" }, 400);
    if (subjectType !== "employee" && subjectType !== "user") return json({ error: "Invalid subjectType" }, 400);

    const table = subjectType === "employee" ? "employees" : "users";
    const { data: subjectRow, error: subjectError } = await admin
      .from(table)
      .select("id, company_id")
      .eq("id", subjectId)
      .maybeSingle();
    if (subjectError || !subjectRow) return json({ error: "Subject not found" }, 404);
    // The subject being indexed must belong to the SAME company as whoever is
    // calling this — otherwise one company could index faces into (or read
    // matches from) another company's Rekognition collection.
    if (subjectRow.company_id !== callerRow.company_id) return json({ error: "Subject does not belong to your company" }, 403);

    const rekognition = getRekognitionClient();
    const collectionId = collectionIdFor(callerRow.company_id);

    try {
      await rekognition.send(new CreateCollectionCommand({ CollectionId: collectionId }));
    } catch (err) {
      // ResourceAlreadyExistsException is expected after the first employee —
      // anything else is a real problem worth surfacing.
      if (err?.name !== "ResourceAlreadyExistsException") throw err;
    }

    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));

    const indexResult = await rekognition.send(
      new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: imageBytes },
        ExternalImageId: subjectId,
        MaxFaces: 1,
        QualityFilter: "AUTO",
        DetectionAttributes: [],
      })
    );

    const faceRecord = indexResult.FaceRecords?.[0];
    if (!faceRecord?.Face?.FaceId) {
      const reason = (indexResult.UnindexedFaces?.[0]?.Reasons ?? []).join(", ") || "no face detected";
      return json({ error: `Could not index face: ${reason}` }, 400);
    }

    const faceId = faceRecord.Face.FaceId;
    const { error: updateError } = await admin.from(table).update({ aws_face_id: faceId }).eq("id", subjectId);
    if (updateError) return json({ error: updateError.message }, 500);

    return json({ success: true, faceId });
  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 500);
  }
});
