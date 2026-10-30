import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FREE_EMPLOYEE_LIMIT = 50;

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
    // owner/manager: always allowed. partner_edit (Admin): full access, same
    // as owner. partner_view (User): a spare-phone account representing one
    // employee/store — also allowed to add employees, per the owner's
    // explicit call that these accounts run store-side operations.
    const allowedRoles = ["owner", "manager", "partner_edit", "partner_view"];
    if (callerRowError || !callerRow || !allowedRoles.includes(callerRow.role)) {
      return json({ error: "Not authorized" }, 403);
    }

    const companyId = callerRow.company_id;
    const body = await req.json();
    const {
      name, phone, email, role, monthly_salary, overtime_rate, work_mode,
      id_proof_type, id_proof_number, site_id, department_id,
    } = body ?? {};

    // Only the name is a hard requirement now — the owner may not have the
    // employee's phone/email on hand at signup time, and a name plus an ID
    // proof number (or nothing else) is enough to get them into the roster.
    if (!name || !role) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (!["employee", "manager"].includes(role)) {
      return json({ error: "Invalid role" }, 400);
    }
    if (work_mode && !["office", "remote"].includes(work_mode)) {
      return json({ error: "Invalid work_mode" }, 400);
    }
    if (id_proof_type && !["aadhaar", "voter_id", "driving_license"].includes(id_proof_type)) {
      return json({ error: "Invalid id_proof_type" }, 400);
    }

    // A branch/site, if given, must actually belong to this company — never
    // trust a client-supplied id blindly for a cross-tenant foreign key.
    if (site_id) {
      const { data: site, error: siteError } = await admin
        .from("sites")
        .select("id")
        .eq("id", site_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (siteError || !site) {
        return json({ error: "Invalid branch/site" }, 400);
      }
    }

    // Same cross-tenant check for department.
    if (department_id) {
      const { data: department, error: departmentError } = await admin
        .from("departments")
        .select("id")
        .eq("id", department_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (departmentError || !department) {
        return json({ error: "Invalid department" }, 400);
      }
    }

    const { count, error: countError } = await admin
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true);
    if (countError) {
      return json({ error: countError.message }, 500);
    }
    if ((count ?? 0) >= FREE_EMPLOYEE_LIMIT) {
      return json({ error: "FREE_LIMIT_REACHED" }, 409);
    }

    const { data: employeeRow, error: insertError } = await admin
      .from("employees")
      .insert({
        name,
        phone: phone || null,
        email: email || null,
        role,
        company_id: companyId,
        created_by: caller.id,
        monthly_salary: monthly_salary || null,
        overtime_rate: overtime_rate || null,
        work_mode: work_mode || "office",
        id_proof_type: id_proof_type || null,
        id_proof_number: id_proof_number || null,
        site_id: site_id || null,
        department_id: department_id || null,
      })
      .select()
      .single();
    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    const { data: company } = await admin
      .from("companies")
      .select("employee_count")
      .eq("id", companyId)
      .single();
    await admin
      .from("companies")
      .update({ employee_count: (company?.employee_count ?? 0) + 1 })
      .eq("id", companyId);

    return json({ employee: employeeRow });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
