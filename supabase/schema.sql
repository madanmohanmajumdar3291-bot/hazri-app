-- Hazri production database schema (Supabase project ckmqbhrmcdeksauejnlp)
-- Snapshot taken from the live database on 2026-10-30. Tables are ordered so
-- foreign keys resolve when run top to bottom on an empty project.

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;

create sequence if not exists public.customer_id_seq;

-- =========================================================================
-- Tables
-- =========================================================================

create table public.companies (
  id uuid default gen_random_uuid() not null,
  company_name text not null,
  address text not null,
  owner_id uuid not null,
  employee_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  customer_id text,
  logo_url text,
  notification_preferences jsonb default '{"notify_late": true, "notify_absent": true, "notify_employee_limit": true}'::jsonb,
  employee_code_prefix text,
  constraint companies_pkey PRIMARY KEY (id),
  constraint companies_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.companies enable row level security;

create table public.company_employee_counters (
  company_id uuid not null,
  next_number integer default 1 not null,
  constraint company_employee_counters_pkey PRIMARY KEY (company_id),
  constraint company_employee_counters_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
alter table public.company_employee_counters enable row level security;

create table public.departments (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint departments_pkey PRIMARY KEY (id),
  constraint departments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
alter table public.departments enable row level security;

create table public.shifts (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  shift_code text not null,
  shift_name text not null,
  start_time text default '00:00'::text not null,
  end_time text default '00:00'::text not null,
  shift_duration text default '00:00'::text not null,
  remove_duplicate_punch text default '00:01'::text not null,
  max_early_hour_allow text default '02:00'::text not null,
  max_ot_allow text default '04:00'::text not null,
  no_of_present_for_weekly_off integer default 0 not null,
  ignore_early_allow boolean default false not null,
  ignore_late_departure boolean default false not null,
  first_weekly_off text default 'Sunday'::text,
  second_weekly_off text default 'Sunday'::text,
  second_weekly_off_weeks jsonb default '[]'::jsonb,
  second_wo_type text default 'None'::text,
  half_day_shift text default 'None'::text,
  single_punch_policy text default 'None'::text,
  created_at timestamp with time zone default now() not null,
  late_grace_minutes integer default 5 not null,
  early_departure_grace_minutes integer default 5 not null,
  is_default boolean default false not null,
  constraint shifts_pkey PRIMARY KEY (id),
  constraint shifts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
alter table public.shifts enable row level security;

create table public.sites (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer default 150 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint sites_pkey PRIMARY KEY (id),
  constraint sites_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
alter table public.sites enable row level security;

create table public.employees (
  id uuid default gen_random_uuid() not null,
  name text not null,
  phone text,
  email text,
  role text not null,
  company_id uuid not null,
  face_embedding jsonb,
  face_registered boolean default false not null,
  face_registered_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  is_active boolean default true not null,
  shift_id uuid,
  employee_code text,
  monthly_salary numeric,
  overtime_rate numeric,
  work_mode text default 'office'::text not null,
  location_consent_given_at timestamp with time zone,
  location_tracking_active boolean default false not null,
  id_proof_type text,
  id_proof_number text,
  site_id uuid,
  department_id uuid,
  photo_url text,
  aws_face_id text,
  face_embeddings jsonb,
  constraint employees_pkey PRIMARY KEY (id),
  constraint employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  constraint employees_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  constraint employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  constraint employees_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  constraint employees_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL,
  constraint employees_id_proof_type_check CHECK ((id_proof_type = ANY (ARRAY['aadhaar'::text, 'voter_id'::text, 'driving_license'::text]))),
  constraint employees_role_check CHECK ((role = ANY (ARRAY['employee'::text, 'manager'::text]))),
  constraint employees_work_mode_check CHECK ((work_mode = ANY (ARRAY['office'::text, 'remote'::text])))
);
alter table public.employees enable row level security;

create table public.users (
  id uuid not null,
  email text not null,
  name text not null,
  phone text,
  role text not null,
  company_id uuid,
  created_at timestamp with time zone default now() not null,
  face_embedding jsonb,
  face_registered boolean default false not null,
  face_registered_at timestamp with time zone,
  failed_face_attempts integer default 0 not null,
  permissions jsonb,
  username text,
  linked_employee_id uuid,
  aws_face_id text,
  face_embeddings jsonb,
  constraint users_pkey PRIMARY KEY (id),
  constraint users_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  constraint users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint users_linked_employee_id_fkey FOREIGN KEY (linked_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  constraint users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'employee'::text, 'partner_edit'::text, 'partner_view'::text])))
);
alter table public.users enable row level security;

create table public.attendance (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  employee_name text not null,
  company_id uuid not null,
  check_in timestamp with time zone,
  check_out timestamp with time zone,
  duration_minutes integer,
  date date not null,
  marked_by text not null,
  status text,
  note text,
  created_at timestamp with time zone default now() not null,
  is_late boolean,
  is_early_departure boolean,
  overtime_minutes integer,
  site_id uuid,
  check_in_lat double precision,
  check_in_lng double precision,
  check_out_lat double precision,
  check_out_lng double precision,
  is_outside_geofence boolean default false,
  marked_by_user_id uuid,
  marked_by_name text,
  manual_checkout boolean default false not null,
  checkout_marked_by_name text,
  constraint attendance_pkey PRIMARY KEY (id),
  constraint attendance_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  constraint attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  constraint attendance_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES auth.users(id),
  constraint attendance_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL,
  constraint attendance_marked_by_check CHECK ((marked_by = ANY (ARRAY['face'::text, 'manual'::text]))),
  constraint attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'half_day'::text, 'leave'::text])))
);
alter table public.attendance enable row level security;

create table public.employee_locations (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  company_id uuid not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision,
  event_type text default 'ping'::text not null,
  site_id uuid,
  is_within_geofence boolean,
  recorded_at timestamp with time zone default now() not null,
  constraint employee_locations_pkey PRIMARY KEY (id),
  constraint employee_locations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  constraint employee_locations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  constraint employee_locations_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL,
  constraint employee_locations_event_type_check CHECK ((event_type = ANY (ARRAY['ping'::text, 'check_in'::text, 'check_out'::text])))
);
alter table public.employee_locations enable row level security;

create table public.leave_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  leave_type text default 'general'::text not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status text default 'pending'::text not null,
  requested_at timestamp with time zone default now() not null,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_note text,
  is_paid boolean,
  constraint leave_requests_pkey PRIMARY KEY (id),
  constraint leave_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  constraint leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  constraint leave_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id),
  constraint leave_requests_leave_type_check CHECK ((leave_type = ANY (ARRAY['general'::text, 'sick'::text, 'casual'::text, 'paid'::text, 'unpaid'::text]))),
  constraint leave_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);
alter table public.leave_requests enable row level security;

create table public.payroll_records (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  month date not null,
  base_salary numeric default 0 not null,
  days_present integer default 0 not null,
  days_absent integer default 0 not null,
  days_half_day integer default 0 not null,
  days_late integer default 0 not null,
  overtime_minutes integer default 0 not null,
  overtime_pay numeric default 0 not null,
  payable_amount numeric default 0 not null,
  notes text,
  generated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  status text default 'pending'::text not null,
  approved_by uuid,
  approved_at timestamp with time zone,
  days_leave integer default 0,
  constraint payroll_records_employee_id_month_key UNIQUE (employee_id, month),
  constraint payroll_records_pkey PRIMARY KEY (id),
  constraint payroll_records_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id),
  constraint payroll_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  constraint payroll_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  constraint payroll_records_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES auth.users(id),
  constraint payroll_records_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'paid'::text])))
);
alter table public.payroll_records enable row level security;

create table public.site_visits (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  site_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  arrived_at timestamp with time zone default now() not null,
  departed_at timestamp with time zone,
  selfie_url text,
  site_photo_url text,
  notes text,
  created_at timestamp with time zone default now() not null,
  constraint site_visits_pkey PRIMARY KEY (id),
  constraint site_visits_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  constraint site_visits_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
alter table public.site_visits enable row level security;

create table public.app_releases (
  id text default 'latest'::text not null,
  apk_url text not null,
  label text,
  notes text,
  updated_at timestamp with time zone default now() not null,
  constraint app_releases_pkey PRIMARY KEY (id)
);
alter table public.app_releases enable row level security;

create table public.facenet_debug_log (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  user_id uuid,
  error_message text,
  error_stack text,
  platform_info text,
  constraint facenet_debug_log_pkey PRIMARY KEY (id)
);
alter table public.facenet_debug_log enable row level security;

-- =========================================================================
-- Functions
-- =========================================================================

CREATE OR REPLACE FUNCTION public.current_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select company_id from public.users where id = auth.uid()
  union all
  select company_id from public.employees where id = auth.uid()
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public."current_role"()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.users where id = auth.uid()
  union all
  select role from public.employees where id = auth.uid()
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_for_username(p_username text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select email from users where lower(username) = lower(p_username) limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_for_phone(p_phone text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select email from users where phone = p_phone limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.assign_customer_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.customer_id is null then
    new.customer_id := 'FM' || nextval('customer_id_seq');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.compute_company_prefix(company_name text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  words text[];
  prefix text;
BEGIN
  words := array(
    SELECT regexp_replace(w, '[^A-Za-z]', '', 'g')
    FROM unnest(regexp_split_to_array(trim(coalesce(company_name, '')), '\s+')) AS w
    WHERE regexp_replace(w, '[^A-Za-z]', '', 'g') <> ''
  );

  IF array_length(words, 1) >= 3 THEN
    prefix := left(words[1], 1) || left(words[2], 1) || left(words[3], 1);
  ELSE
    prefix := array_to_string(words, '');
  END IF;

  RETURN upper(left(prefix || 'XXX', 3));
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_company_prefix()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.employee_code_prefix IS NULL THEN
    NEW.employee_code_prefix := compute_company_prefix(NEW.company_name);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_employee_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  seq_number integer;
  code_prefix text;
BEGIN
  IF NEW.employee_code IS NULL THEN
    INSERT INTO company_employee_counters (company_id, next_number)
    VALUES (NEW.company_id, 2)
    ON CONFLICT (company_id) DO UPDATE SET next_number = company_employee_counters.next_number + 1
    RETURNING next_number - 1 INTO seq_number;

    SELECT COALESCE(employee_code_prefix, 'EMP') INTO code_prefix
    FROM companies WHERE id = NEW.company_id;

    NEW.employee_code := code_prefix || lpad(seq_number::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_payroll_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_daily_absences(target_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO attendance (employee_id, employee_name, company_id, date, status, marked_by, note)
  SELECT e.id, e.name, e.company_id, target_date, 'absent', 'manual', 'Auto-marked absent — no check-in recorded'
  FROM employees e
  WHERE e.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.employee_id = e.id AND a.date = target_date
    );
END;
$function$;

-- =========================================================================
-- Triggers
-- =========================================================================

create trigger trg_assign_customer_id before insert on public.companies
  for each row execute function assign_customer_id();
create trigger trg_assign_company_prefix before insert on public.companies
  for each row execute function assign_company_prefix();
create trigger trg_assign_employee_code before insert on public.employees
  for each row execute function assign_employee_code();
create trigger trg_touch_payroll_updated_at before update on public.payroll_records
  for each row execute function touch_payroll_updated_at();

-- =========================================================================
-- Row level security policies
-- =========================================================================

create policy "read own company" on public.companies for select to authenticated
  using (id = current_company_id());
create policy "owner can create own company" on public.companies for insert to authenticated
  with check (owner_id = auth.uid());
create policy "staff can update own company" on public.companies for update to authenticated
  using ((id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'manager'::text, 'partner_edit'::text])))
  with check ((id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'manager'::text, 'partner_edit'::text])));

create policy "read users in own company" on public.users for select to authenticated
  using ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'manager'::text, 'partner_edit'::text, 'partner_view'::text])));
create policy "self insert on signup" on public.users for insert to authenticated
  with check (id = auth.uid());
create policy "self or company admin update" on public.users for update to authenticated
  using ((id = auth.uid()) OR ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text]))))
  with check ((id = auth.uid()) OR ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text]))));

create policy "read employees in own company" on public.employees for select to authenticated
  using (company_id = current_company_id());
create policy "staff can update employees in own company" on public.employees for update to authenticated
  using ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'manager'::text, 'partner_edit'::text])))
  with check ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'manager'::text, 'partner_edit'::text])));
create policy "staff can delete employees in own company" on public.employees for delete
  using ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'manager'::text, 'partner_edit'::text])));

create policy "read attendance in own company" on public.attendance for select to authenticated
  using (company_id = current_company_id());
create policy "insert attendance in own company" on public.attendance for insert to authenticated
  with check (company_id = current_company_id());
create policy "update attendance in own company" on public.attendance for update to authenticated
  using (company_id = current_company_id())
  with check (company_id = current_company_id());

create policy "read shifts in own company" on public.shifts for select to authenticated
  using (company_id = current_company_id());
create policy "owner or admin insert shifts" on public.shifts for insert to authenticated
  with check ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])));
create policy "owner or admin update shifts" on public.shifts for update to authenticated
  using ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])))
  with check ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])));
create policy "owner or admin delete shifts" on public.shifts for delete to authenticated
  using ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])));

create policy "owner or admin read payroll" on public.payroll_records for select to authenticated
  using ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])));
create policy "owner or admin write payroll" on public.payroll_records for insert to authenticated
  with check ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])));
create policy "owner or admin update payroll" on public.payroll_records for update to authenticated
  using ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])))
  with check ((company_id = current_company_id()) AND ("current_role"() = ANY (ARRAY['owner'::text, 'partner_edit'::text])));

create policy "Company members can view sites" on public.sites for select
  using (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));
create policy "Owners/managers can manage sites" on public.sites for all
  using (company_id IN (SELECT users.company_id FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

create policy "Company members can view departments" on public.departments for select
  using (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));
create policy "Owners/managers can manage departments" on public.departments for all
  using (company_id IN (SELECT users.company_id FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

create policy "Company members can view locations" on public.employee_locations for select
  using (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));
create policy "Anyone in company can insert their pings" on public.employee_locations for insert
  with check (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));

create policy "Company members can view leave requests" on public.leave_requests for select
  using (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));
create policy "Company members can create leave requests" on public.leave_requests for insert
  with check (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));
create policy "Owners/managers can review leave requests" on public.leave_requests for update
  using (company_id IN (SELECT users.company_id FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['owner'::text, 'manager'::text])))));

create policy "Company members can view site visits" on public.site_visits for select
  using (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));
create policy "Company members can insert site visits" on public.site_visits for insert
  with check (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));
create policy "Company members can update site visits" on public.site_visits for update
  using (company_id IN (SELECT users.company_id FROM users WHERE (users.id = auth.uid())));

create policy "anyone can read the latest release" on public.app_releases for select to anon, authenticated
  using (true);

create policy "authenticated can insert facenet debug rows" on public.facenet_debug_log for insert to authenticated
  with check (true);

-- =========================================================================
-- Storage buckets and policies
-- =========================================================================

insert into storage.buckets (id, name, public) values
  ('company-logos', 'company-logos', true),
  ('visit-photos', 'visit-photos', true),
  ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit) values
  ('app-releases', 'app-releases', true, 314572800)
on conflict (id) do nothing;

create policy "authenticated read company logos" on storage.objects for select to authenticated
  using (bucket_id = 'company-logos');
create policy "authenticated upload company logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'company-logos');
create policy "authenticated update company logos" on storage.objects for update to authenticated
  using (bucket_id = 'company-logos');
create policy "public read company logos" on storage.objects for select to anon
  using (bucket_id = 'company-logos');
create policy "Company members can upload visit photos" on storage.objects for insert
  with check ((bucket_id = 'visit-photos') AND (auth.uid() IS NOT NULL));
create policy "Anyone can view visit photos" on storage.objects for select
  using (bucket_id = 'visit-photos');
create policy "authenticated upload employee photos" on storage.objects for insert
  with check ((bucket_id = 'employee-photos') AND (auth.uid() IS NOT NULL));
create policy "authenticated update employee photos" on storage.objects for update
  using ((bucket_id = 'employee-photos') AND (auth.uid() IS NOT NULL));
create policy "public read employee photos" on storage.objects for select
  using (bucket_id = 'employee-photos');

-- =========================================================================
-- Scheduled jobs
-- =========================================================================

-- 18:30 UTC = 00:00 IST: auto-mark absences for the day that just ended.
select cron.schedule('mark-daily-absences', '30 18 * * *', $$SELECT mark_daily_absences(current_date);$$);
