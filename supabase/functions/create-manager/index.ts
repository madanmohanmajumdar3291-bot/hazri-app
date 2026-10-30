import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FREE_MANAGER_LIMIT = 2;

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
    if (callerRowError || !callerRow || callerRow.role !== "owner") {
      return json({ error: "Only the owner can create manager accounts" }, 403);
    }

    const companyId = callerRow.company_id;
    const body = await req.json();
    const { name, phone, email, password, permissions } = body ?? {};

    if (!name || !email || !phone || !password) {
      return json({ error: "Missing required fields" }, 400);
    }

    const { count, error: countError } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", "manager");
    if (countError) {
      return json({ error: countError.message }, 500);
    }
    if ((count ?? 0) >= FREE_MANAGER_LIMIT) {
      return json({ error: "FREE_LIMIT_REACHED" }, 409);
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

    const managerId = created.user.id;

    // A User/manager account is also a real employee — they need to show up
    // in the attendance face-scan roster and be trackable like anyone else,
    // so a linked row in `employees` is created alongside the login account
    // (the FK employees(id) is what attendance.employee_id points at, and
    // there's no separate path for login-only accounts to mark attendance).
    const { data: employeeRow, error: employeeInsertError } = await admin
      .from("employees")
      .insert({
        name,
        phone,
        email,
        role: "manager",
        company_id: companyId,
        created_by: caller.id,
        work_mode: "office",
      })
      .select()
      .single();
    if (employeeInsertError) {
      await admin.auth.admin.deleteUser(managerId);
      return json({ error: employeeInsertError.message }, 500);
    }

    const { data: managerRow, error: insertError } = await admin
      .from("users")
      .insert({
        id: managerId,
        email,
        name,
        phone,
        role: "manager",
        company_id: companyId,
        linked_employee_id: employeeRow.id,
        permissions: permissions ?? {
          can_add_employees: false,
          can_view_attendance: false,
          can_manual_mark: false,
        },
      })
      .select()
      .single();
    if (insertError) {
      await admin.from("employees").delete().eq("id", employeeRow.id);
      await admin.auth.admin.deleteUser(managerId);
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

    return json({ manager: managerRow });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
