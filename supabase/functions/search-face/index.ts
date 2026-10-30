import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { RekognitionClient, SearchFacesByImageCommand } from "npm:@aws-sdk/client-rekognition@3";

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
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are not configured on this project yet.");
  }
  return new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

// How confident Rekognition has to be before we trust the match — kept
// strict (0-100 scale) for the same reason the on-device matcher requires a
// clear margin: a false accept here marks the WRONG person's attendance or
// unlocks the menu as the wrong account, a much worse outcome than asking
// for a re-scan.
const FACE_MATCH_THRESHOLD = 92;

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
    const { imageBase64 } = body ?? {};
    if (!imageBase64) return json({ error: "Missing imageBase64" }, 400);

    const rekognition = getRekognitionClient();
    const collectionId = collectionIdFor(callerRow.company_id);
    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));

    try {
      const result = await rekognition.send(
        new SearchFacesByImageCommand({
          CollectionId: collectionId,
          Image: { Bytes: imageBytes },
          MaxFaces: 1,
          FaceMatchThreshold: FACE_MATCH_THRESHOLD,
        })
      );

      const bestMatch = result.FaceMatches?.[0];
      if (!bestMatch?.Face?.ExternalImageId) {
        return json({ matched: false });
      }

      return json({
        matched: true,
        subjectId: bestMatch.Face.ExternalImageId,
        confidence: bestMatch.Similarity,
      });
    } catch (err) {
      // No face in the frame, or nobody registered yet (collection doesn't
      // exist) — both are "no match", not a real error the caller needs to see.
      if (err?.name === "InvalidParameterException" || err?.name === "ResourceNotFoundException") {
        return json({ matched: false });
      }
      throw err;
    }
  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 500);
  }
});
