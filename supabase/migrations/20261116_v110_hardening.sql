-- Hazri v1.1.0 security and data-integrity hardening.
-- Audit references (docs/AUDIT-v1.1.0.md): C1, C2, C4, H5, H6, H7, H8, H9, H10, M5, M11.
-- Backward compatible with v1.0.x clients except where noted (see bottom).
-- Run inside one transaction; every statement is idempotent.

begin;

-- ---------------------------------------------------------------------------
-- C1: users may not change their own role, company or permissions.
-- The UPDATE policy stays (users update their own face data and
-- failed_face_attempts); this trigger restricts WHICH columns may change.
-- Service-role calls (edge functions) and direct SQL have no auth.uid() and
-- are not restricted.
-- ---------------------------------------------------------------------------
create or replace function public.guard_users_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  caller_company uuid;
begin
  if caller is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.role is distinct from old.role
     or new.email is distinct from old.email
     or new.aws_face_id is distinct from old.aws_face_id then
    raise exception 'Not allowed to change account identity, role or company'
      using errcode = '42501';
  end if;

  if new.permissions is distinct from old.permissions
     or new.linked_employee_id is distinct from old.linked_employee_id then
    select u.role, u.company_id into caller_role, caller_company
    from public.users u where u.id = caller;
    -- Only the owner or an Admin partner of the same company may change
    -- another account's permissions or linked employee; nobody but the
    -- owner may change their own.
    if caller_company is distinct from old.company_id
       or caller_role not in ('owner', 'partner_edit')
       or (old.id = caller and caller_role <> 'owner') then
      raise exception 'Not allowed to change permissions' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_users_update on public.users;
create trigger trg_guard_users_update
  before update on public.users
  for each row execute function public.guard_users_update();

-- C2: accounts are only ever created by the signup-owner / create-manager /
-- create-partner edge functions (service role). No client inserts into users.
drop policy if exists "self insert on signup" on public.users;

-- ---------------------------------------------------------------------------
-- C4 / H5 / H6: one attendance row per employee per day, idempotent sync,
-- server receipt time, clock sanity, server-side geofence.
-- ---------------------------------------------------------------------------
alter table public.attendance add column if not exists client_txn_id uuid;
alter table public.attendance add column if not exists server_received_at timestamptz;
alter table public.attendance add column if not exists clock_suspect boolean not null default false;
alter table public.attendance add column if not exists updated_at timestamptz;

create unique index if not exists attendance_employee_date_uniq
  on public.attendance (employee_id, date);
create unique index if not exists attendance_client_txn_uniq
  on public.attendance (client_txn_id) where client_txn_id is not null;

-- Great-circle distance in metres.
create or replace function public.haversine_m(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

create or replace function public.attendance_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  emp_mode text;
  nearest record;
  has_sites boolean;
begin
  if tg_op = 'INSERT' then
    new.server_received_at := now();
  else
    new.server_received_at := old.server_received_at;
    new.client_txn_id := coalesce(old.client_txn_id, new.client_txn_id);
  end if;
  new.updated_at := now();

  if new.check_in is not null and new.check_out is not null and new.check_out < new.check_in then
    raise exception 'check_out is before check_in' using errcode = '22023';
  end if;

  -- A phone clock running ahead is the cheap way to forge a time. Keep the
  -- record (never discard attendance) but flag it for review.
  new.clock_suspect := coalesce(new.check_in > now() + interval '5 minutes', false)
                    or coalesce(new.check_out > now() + interval '5 minutes', false)
                    or (tg_op = 'UPDATE' and old.clock_suspect);

  -- Server-side geofence: recompute from the submitted coordinates instead of
  -- trusting the client's is_outside_geofence flag.
  if new.check_in_lat is not null and new.check_in_lng is not null
     and (tg_op = 'INSERT'
          or new.check_in_lat is distinct from old.check_in_lat
          or new.check_in_lng is distinct from old.check_in_lng) then
    select work_mode into emp_mode from employees where id = new.employee_id;
    select exists(select 1 from sites where company_id = new.company_id and coalesce(is_active, true))
      into has_sites;
    if coalesce(emp_mode, 'office') = 'remote' or not has_sites then
      new.is_outside_geofence := false;
    else
      select s.id, s.radius_meters,
             haversine_m(new.check_in_lat, new.check_in_lng, s.latitude, s.longitude) as dist
        into nearest
        from sites s
       where s.company_id = new.company_id and coalesce(s.is_active, true)
       order by dist asc
       limit 1;
      new.is_outside_geofence := nearest.dist > coalesce(nearest.radius_meters, 200);
      if not new.is_outside_geofence then
        new.site_id := nearest.id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attendance_before_write on public.attendance;
create trigger trg_attendance_before_write
  before insert or update on public.attendance
  for each row execute function public.attendance_before_write();

-- Idempotent merge used by v1.1.0's offline sync. SECURITY INVOKER, so RLS
-- (same-company only) still applies. Retrying the same payload converges on
-- the same row: earliest check-in wins, latest check-out wins. An
-- auto-marked absence for the day is replaced by the real scan.
create or replace function public.sync_attendance(p jsonb)
returns public.attendance
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_txn uuid := nullif(p->>'client_txn_id', '')::uuid;
  v_emp uuid := (p->>'employee_id')::uuid;
  v_date date := (p->>'date')::date;
  v_in timestamptz := nullif(p->>'check_in', '')::timestamptz;
  v_out timestamptz := nullif(p->>'check_out', '')::timestamptz;
  cur public.attendance;
  result public.attendance;
  merged_in timestamptz;
  merged_out timestamptz;
  out_is_new boolean;
  shift_row record;
begin
  if v_emp is null or v_date is null then
    raise exception 'employee_id and date are required' using errcode = '22023';
  end if;

  -- Already applied (e.g. the response was lost and the client retried).
  if v_txn is not null then
    select * into cur from attendance where client_txn_id = v_txn;
  end if;
  if cur.id is null then
    select * into cur from attendance where employee_id = v_emp and date = v_date for update;
  end if;

  if cur.id is null then
    insert into attendance (
      employee_id, employee_name, company_id, date, check_in, check_out, duration_minutes,
      marked_by, status, note, site_id, check_in_lat, check_in_lng, check_out_lat, check_out_lng,
      is_outside_geofence, overtime_minutes, is_early_departure, client_txn_id
    ) values (
      v_emp, p->>'employee_name', (p->>'company_id')::uuid, v_date, v_in, v_out,
      case when v_in is not null and v_out is not null then round(extract(epoch from (v_out - v_in)) / 60)::int end,
      coalesce(p->>'marked_by', 'face'), nullif(p->>'status', ''), nullif(p->>'note', ''),
      nullif(p->>'site_id', '')::uuid,
      (p->>'check_in_lat')::double precision, (p->>'check_in_lng')::double precision,
      (p->>'check_out_lat')::double precision, (p->>'check_out_lng')::double precision,
      coalesce((p->>'is_outside_geofence')::boolean, false),
      (p->>'overtime_minutes')::int, (p->>'is_early_departure')::boolean, v_txn
    )
    on conflict (employee_id, date) do nothing
    returning * into result;

    if result.id is not null then
      cur := result;
    else
      -- Lost a race with another device: merge into the row it created.
      select * into cur from attendance where employee_id = v_emp and date = v_date for update;
    end if;
  end if;

  if result.id is null then
    merged_in := case
      when cur.check_in is null then v_in
      when v_in is null then cur.check_in
      else least(cur.check_in, v_in) end;
    merged_out := case
      when cur.check_out is null then v_out
      when v_out is null then cur.check_out
      else greatest(cur.check_out, v_out) end;
    out_is_new := v_out is not null and merged_out = v_out and v_out is distinct from cur.check_out;

    update attendance set
      check_in = merged_in,
      check_out = merged_out,
      duration_minutes = case when merged_in is not null and merged_out is not null
                              then round(extract(epoch from (merged_out - merged_in)) / 60)::int
                              else duration_minutes end,
      -- The cron's "no check-in" absence is wrong once a real scan arrives.
      status = case when cur.status = 'absent' and merged_in is not null
                    then nullif(p->>'status', '')
                    when out_is_new then nullif(p->>'status', '')
                    else cur.status end,
      note = case when cur.note like 'Auto-marked absent%' and merged_in is not null then null else cur.note end,
      marked_by = case when cur.status = 'absent' and cur.marked_by = 'manual' and merged_in is not null
                       then 'face' else cur.marked_by end,
      check_in_lat = case when merged_in = v_in and v_in is distinct from cur.check_in
                          then (p->>'check_in_lat')::double precision else cur.check_in_lat end,
      check_in_lng = case when merged_in = v_in and v_in is distinct from cur.check_in
                          then (p->>'check_in_lng')::double precision else cur.check_in_lng end,
      check_out_lat = case when out_is_new then (p->>'check_out_lat')::double precision else cur.check_out_lat end,
      check_out_lng = case when out_is_new then (p->>'check_out_lng')::double precision else cur.check_out_lng end,
      overtime_minutes = case when out_is_new then (p->>'overtime_minutes')::int else cur.overtime_minutes end,
      is_early_departure = case when out_is_new then (p->>'is_early_departure')::boolean else cur.is_early_departure end,
      manual_checkout = case when out_is_new then false else cur.manual_checkout end,
      checkout_marked_by_name = case when out_is_new then null else cur.checkout_marked_by_name end,
      client_txn_id = coalesce(cur.client_txn_id, v_txn)
    where id = cur.id
    returning * into result;
  end if;

  -- Late flag, recomputed from the merged check-in (the native offline path
  -- never computed it, and a merge can move the check-in earlier). Shift times are
  -- wall-clock "HH:MM" in the company's local time (Asia/Kolkata for every
  -- current company; there is no per-company timezone column yet).
  if result.check_in is not null then
    select s.start_time, s.late_grace_minutes into shift_row
      from employees e
      left join shifts s on s.id = e.shift_id
     where e.id = result.employee_id;
    if shift_row.start_time is null then
      select s.start_time, s.late_grace_minutes into shift_row
        from shifts s where s.company_id = result.company_id and s.is_default limit 1;
    end if;
    if shift_row.start_time ~ '^\d{1,2}:\d{2}$' then
      update attendance
         set is_late = (result.check_in at time zone 'Asia/Kolkata')
                       > (result.date + shift_row.start_time::time
                          + make_interval(mins => coalesce(shift_row.late_grace_minutes, 0)))
       where id = result.id
      returning * into result;
    end if;
  end if;

  return result;
end;
$$;

revoke execute on function public.sync_attendance(jsonb) from anon, public;
grant execute on function public.sync_attendance(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- H7: audit history for attendance changes. Written only by the trigger.
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_audit (
  id bigint generated always as identity primary key,
  attendance_id uuid not null,
  company_id uuid not null,
  action text not null,
  changed_by uuid,
  changed_by_role text,
  changed_at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);
create index if not exists attendance_audit_att_idx on public.attendance_audit (attendance_id);
create index if not exists attendance_audit_company_idx on public.attendance_audit (company_id, changed_at desc);
alter table public.attendance_audit enable row level security;

drop policy if exists "staff read attendance audit" on public.attendance_audit;
create policy "staff read attendance audit" on public.attendance_audit for select to authenticated
  using (company_id = public.current_company_id()
         and public."current_role"() in ('owner', 'partner_edit', 'manager'));

create or replace function public.audit_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Face scans are the normal case; only hand-entered rows are audited on insert.
    if new.marked_by = 'manual' and auth.uid() is not null then
      insert into attendance_audit (attendance_id, company_id, action, changed_by, changed_by_role, new_row)
      values (new.id, new.company_id, 'insert', auth.uid(), public."current_role"(), to_jsonb(new));
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    insert into attendance_audit (attendance_id, company_id, action, changed_by, changed_by_role, old_row, new_row)
    values (new.id, new.company_id, 'update', auth.uid(), public."current_role"(), to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into attendance_audit (attendance_id, company_id, action, changed_by, changed_by_role, old_row)
    values (old.id, old.company_id, 'delete', auth.uid(), public."current_role"(), to_jsonb(old));
    return old;
  end if;
end;
$$;

drop trigger if exists trg_audit_attendance on public.attendance;
create trigger trg_audit_attendance
  after insert or update or delete on public.attendance
  for each row execute function public.audit_attendance();

-- ---------------------------------------------------------------------------
-- H8 / H9: storage scoped to the caller's company folder.
-- ---------------------------------------------------------------------------
drop policy if exists "signed-in users view visit photos" on storage.objects;
drop policy if exists "Company members can upload visit photos" on storage.objects;
create policy "company reads own visit photos" on storage.objects for select to authenticated
  using (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "company uploads own visit photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-photos' and (storage.foldername(name))[1] = public.current_company_id()::text);

drop policy if exists "authenticated upload company logos" on storage.objects;
drop policy if exists "authenticated update company logos" on storage.objects;
drop policy if exists "authenticated read company logos" on storage.objects;
create policy "staff upload own company logo" on storage.objects for insert to authenticated
  with check (bucket_id = 'company-logos'
              and (storage.foldername(name))[1] = public.current_company_id()::text
              and public."current_role"() in ('owner', 'manager', 'partner_edit'));
create policy "staff update own company logo" on storage.objects for update to authenticated
  using (bucket_id = 'company-logos'
         and (storage.foldername(name))[1] = public.current_company_id()::text
         and public."current_role"() in ('owner', 'manager', 'partner_edit'));
create policy "authenticated read company logos" on storage.objects for select to authenticated
  using (bucket_id = 'company-logos');

-- ---------------------------------------------------------------------------
-- H10: per-phone login throttle for the phone-login edge function
-- (service role only; no client access).
-- ---------------------------------------------------------------------------
create table if not exists public.login_throttle (
  key text primary key,
  failures int not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.login_throttle enable row level security;
revoke all on public.login_throttle from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Crash and error reports from the app (no passwords, tokens or face data;
-- the client scrubs before sending). Insert-only for clients.
-- ---------------------------------------------------------------------------
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  company_id uuid,
  app_version text check (length(app_version) <= 40),
  update_id text check (length(update_id) <= 80),
  platform text check (length(platform) <= 20),
  os_version text check (length(os_version) <= 40),
  device_model text check (length(device_model) <= 80),
  is_fatal boolean not null default false,
  error_name text check (length(error_name) <= 200),
  message text check (length(message) <= 1000),
  stack text check (length(stack) <= 4000),
  context jsonb check (pg_column_size(context) <= 4000)
);
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
drop policy if exists "clients report errors" on public.client_errors;
create policy "clients report errors" on public.client_errors for insert to anon, authenticated
  with check (true);

-- Who sent it is decided by the server, never by the client payload.
create or replace function public.stamp_client_error()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.company_id := case when auth.uid() is null then null else public.current_company_id() end;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists trg_stamp_client_error on public.client_errors;
create trigger trg_stamp_client_error
  before insert on public.client_errors
  for each row execute function public.stamp_client_error();

-- ---------------------------------------------------------------------------
-- M5: auto-absence skips weekly offs, approved leave (marked as leave) and
-- days before the employee existed.
-- ---------------------------------------------------------------------------
create or replace function public.mark_daily_absences(target_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into attendance (employee_id, employee_name, company_id, date, status, marked_by, note)
  select e.id, e.name, e.company_id, target_date,
         case when lr.id is not null then 'leave' else 'absent' end,
         'manual',
         case when lr.id is not null then 'Auto-marked: approved leave'
              else 'Auto-marked absent — no check-in recorded' end
  from employees e
  left join lateral (
    select s.* from shifts s
     where s.id = e.shift_id
        or (e.shift_id is null and s.company_id = e.company_id and s.is_default)
     order by (s.id = e.shift_id) desc
     limit 1
  ) sh on true
  left join lateral (
    select l.id from leave_requests l
     where l.employee_id = e.id and l.status = 'approved'
       and target_date between l.start_date and l.end_date
     limit 1
  ) lr on true
  where e.is_active = true
    and e.created_at::date <= target_date
    and (sh.first_weekly_off is null or sh.first_weekly_off <> trim(to_char(target_date, 'FMDay')))
    and not exists (select 1 from attendance a where a.employee_id = e.id and a.date = target_date)
  on conflict (employee_id, date) do nothing;
end;
$$;

-- M11: helper functions are only meaningful for signed-in users.
revoke execute on function public.current_company_id() from anon, public;
revoke execute on function public."current_role"() from anon, public;
grant execute on function public.current_company_id() to authenticated;
grant execute on function public."current_role"() to authenticated;

commit;

-- Compatibility notes:
-- * v1.0.x phones: their offline sync does a plain INSERT. A second row for
--   the same employee+day now fails with 23505 instead of creating a
--   duplicate; the scan stays queued on that phone (not lost) until the
--   phone is updated to v1.1.0, whose sync calls sync_attendance().
-- * get_email_for_phone is still callable by anon for v1.0.0/1.0.1 phones;
--   revoke it with 20261104b once those are retired.
