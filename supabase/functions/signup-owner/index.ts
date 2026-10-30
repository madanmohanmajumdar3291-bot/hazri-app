import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { fullName, email, phone, companyName, companyAddress, password } = body ?? {};

    if (!fullName || !email || !phone || !companyName || !password) {
      return json({ error: "Missing required fields" }, 400);
    }

    // Runs entirely with the service role, so no RLS timing races (the
    // previous client-side flow could create the auth account, then hit an
    // RLS check on the very next request before the fresh session was fully
    // recognized, leaving an orphaned auth user forever stuck between
    // "already registered" and "no account data to log into"). Any failure
    // after creating the auth user now rolls it back explicitly instead of
    // leaving that broken half-state behind.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) {
      const message = /already.*registered|already.*exists/i.test(createError.message)
        ? "EMAIL_ALREADY_EXISTS"
        : createError.message;
      return json({ error: message }, 400);
    }

    const uid = created.user.id;

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ company_name: companyName, address: companyAddress, owner_id: uid })
      .select()
      .single();
    if (companyError) {
      await admin.auth.admin.deleteUser(uid);
      return json({ error: companyError.message }, 500);
    }

    const { data: userRow, error: userError } = await admin
      .from("users")
      .insert({
        id: uid,
        email,
        name: fullName,
        phone,
        role: "owner",
        company_id: company.id,
      })
      .select()
      .single();
    if (userError) {
      await admin.from("companies").delete().eq("id", company.id);
      await admin.auth.admin.deleteUser(uid);
      return json({ error: userError.message }, 500);
    }

    return json({ user: userRow });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
