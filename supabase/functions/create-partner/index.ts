import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIER_LIMITS: Record<string, number> = { partner_edit: 2, partner_view: 3 };
const TIER_LABELS: Record<string, string> = { partner_edit: "admin", partner_view: "user" };

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
      return json({ error: "Only the owner can invite an Admin or User" }, 403);
    }

    const companyId = callerRow.company_id;
    const body = await req.json();
    const { name, phone, email, password, tier, linked_employee_id } = body ?? {};

    if (!name || !email || !phone || !password) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (tier !== "partner_edit" && tier !== "partner_view") {
      return json({ error: "Invalid tier" }, 400);
    }

    if (linked_employee_id) {
      const { data: employeeRow, error: employeeError } = await admin
        .from("employees")
        .select("id, company_id")
        .eq("id", linked_employee_id)
        .maybeSingle();
      if (employeeError || !employeeRow || employeeRow.company_id !== companyId) {
        return json({ error: "Invalid linked employee" }, 400);
      }
    }

    const { count, error: countError } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", tier);
    if (countError) {
      return json({ error: countError.message }, 500);
    }
    const limit = TIER_LIMITS[tier];
    if ((count ?? 0) >= limit) {
      const label = TIER_LABELS[tier];
      const plural = limit === 1 ? "" : "s";
      return json(
        { error: `Free plan allows ${limit} ${label}${plural} account${plural}. Upgrade to add more ${label}${plural}.` },
        403
      );
    }

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

    const partnerId = created.user.id;

    const { data: partnerRow, error: insertError } = await admin
      .from("users")
      .insert({
        id: partnerId,
        email,
        name,
        phone,
        role: tier,
        company_id: companyId,
        linked_employee_id: tier === "partner_view" ? linked_employee_id || null : null,
      })
      .select()
      .single();
    if (insertError) {
      await admin.auth.admin.deleteUser(partnerId);
      return json({ error: insertError.message }, 500);
    }

    return json({ partner: partnerRow });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
