-- Database security and attendance-integrity tests for v1.1.0.
-- Run with tests/run_db_tests.sh. Every test raises on failure; the script
-- stops at the first failure (ON_ERROR_STOP) and prints PASS lines otherwise.

\set QUIET on
set client_min_messages = warning;

-- ---------- fixtures (as superuser) ----------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'ownera@test'),
  ('a0000000-0000-0000-0000-000000000002', 'managera@test'),
  ('a0000000-0000-0000-0000-000000000003', 'viewa@test'),
  ('b0000000-0000-0000-0000-000000000001', 'ownerb@test');
insert into companies (id, company_name, address, owner_id) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Alpha Traders', 'Mumbai', 'a0000000-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Beta Works', 'Pune', 'b0000000-0000-0000-0000-000000000001');
insert into users (id, email, name, role, company_id, permissions) values
  ('a0000000-0000-0000-0000-000000000001', 'ownera@test', 'Owner A', 'owner', 'aaaaaaaa-0000-0000-0000-000000000000', null),
  ('a0000000-0000-0000-0000-000000000002', 'managera@test', 'Manager A', 'manager', 'aaaaaaaa-0000-0000-0000-000000000000', '{"can_add_employees": false}'),
  ('a0000000-0000-0000-0000-000000000003', 'viewa@test', 'View A', 'partner_view', 'aaaaaaaa-0000-0000-0000-000000000000', null),
  ('b0000000-0000-0000-0000-000000000001', 'ownerb@test', 'Owner B', 'owner', 'bbbbbbbb-0000-0000-0000-000000000000', null);
insert into shifts (id, company_id, shift_code, shift_name, start_time, end_time, late_grace_minutes, early_departure_grace_minutes, is_default, first_weekly_off)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'GEN', 'General', '09:00', '18:00', 5, 0, true, 'Sunday');
insert into sites (id, company_id, name, latitude, longitude, radius_meters, is_active)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'HQ', 19.0760, 72.8777, 100, true);
insert into employees (id, name, role, company_id, created_at) values
  ('e0000000-0000-0000-0000-00000000000a', 'Asha', 'employee', 'aaaaaaaa-0000-0000-0000-000000000000', '2026-01-01'),
  ('e0000000-0000-0000-0000-00000000000b', 'Bala', 'employee', 'bbbbbbbb-0000-0000-0000-000000000000', '2026-01-01'),
  ('e0000000-0000-0000-0000-00000000000c', 'Chetan', 'employee', 'aaaaaaaa-0000-0000-0000-000000000000', '2026-01-01');

create function pg_temp.claims(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
create function pg_temp.expect_error(sql text, code text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = code then raise notice 'PASS %', label; return; end if;
    raise exception 'FAIL %: expected % got % (%)', label, code, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL %: statement succeeded but should have failed', label;
end $$;
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL %', label; end if;
  raise notice 'PASS %', label;
end $$;
set client_min_messages = notice;

-- ===================== C1: users privilege escalation =====================
select pg_temp.claims('a0000000-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.expect_error($$update users set role = 'owner' where id = auth.uid()$$, '42501', 'manager cannot make self owner');
select pg_temp.expect_error($$update users set company_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = auth.uid()$$, '42501', 'manager cannot move self to another company');
select pg_temp.expect_error($$update users set permissions = '{"can_add_employees": true}' where id = auth.uid()$$, '42501', 'manager cannot grant self permissions');
update users set failed_face_attempts = 2, face_embedding = '[0.1,0.2]' where id = auth.uid();
reset role;
select pg_temp.ok((select failed_face_attempts = 2 from users where id = 'a0000000-0000-0000-0000-000000000002'), 'manager can still update own face data');

select pg_temp.claims('a0000000-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.expect_error($$update users set role = 'partner_edit' where id = auth.uid()$$, '42501', 'view partner cannot upgrade self');
select pg_temp.expect_error($$insert into users (id, email, name, role, company_id) values (auth.uid(), 'x@x', 'x', 'owner', 'bbbbbbbb-0000-0000-0000-000000000000')$$, '42501', 'no client inserts into users');
reset role;

select pg_temp.claims('a0000000-0000-0000-0000-000000000001');
set role authenticated;
update users set permissions = '{"can_add_employees": true}' where id = 'a0000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.ok((select (permissions->>'can_add_employees')::boolean from users where id = 'a0000000-0000-0000-0000-000000000002'), 'owner can change a manager''s permissions');

select pg_temp.claims('b0000000-0000-0000-0000-000000000001');
set role authenticated;
update users set permissions = '{}' where id = 'a0000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.ok((select (permissions->>'can_add_employees')::boolean from users where id = 'a0000000-0000-0000-0000-000000000002'), 'other company''s owner cannot touch the manager');

-- service role / SQL (no auth.uid) is unrestricted
select set_config('request.jwt.claims', '', false);
update users set role = 'manager' where id = 'a0000000-0000-0000-0000-000000000002';
select pg_temp.ok(true, 'service-role updates still allowed');

-- ===================== C4: idempotent sync and merge =====================
select pg_temp.claims('a0000000-0000-0000-0000-000000000003');
set role authenticated;
select sync_attendance('{"client_txn_id":"11111111-0000-0000-0000-000000000001","employee_id":"e0000000-0000-0000-0000-00000000000a","employee_name":"Asha","company_id":"aaaaaaaa-0000-0000-0000-000000000000","date":"2026-11-10","check_in":"2026-11-10T09:10:00+05:30","marked_by":"face"}'::jsonb);
select sync_attendance('{"client_txn_id":"11111111-0000-0000-0000-000000000001","employee_id":"e0000000-0000-0000-0000-00000000000a","employee_name":"Asha","company_id":"aaaaaaaa-0000-0000-0000-000000000000","date":"2026-11-10","check_in":"2026-11-10T09:10:00+05:30","marked_by":"face"}'::jsonb);
reset role;
select pg_temp.ok((select count(*) = 1 from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000a' and date = '2026-11-10'), 'retrying the same sync creates one row');

-- second device, earlier check-in plus a checkout
select pg_temp.claims('a0000000-0000-0000-0000-000000000003');
set role authenticated;
select sync_attendance('{"client_txn_id":"22222222-0000-0000-0000-000000000002","employee_id":"e0000000-0000-0000-0000-00000000000a","employee_name":"Asha","company_id":"aaaaaaaa-0000-0000-0000-000000000000","date":"2026-11-10","check_in":"2026-11-10T09:00:00+05:30","check_out":"2026-11-10T18:00:00+05:30","overtime_minutes":0,"is_early_departure":false,"marked_by":"face"}'::jsonb);
reset role;
select pg_temp.ok((select count(*) = 1 from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000a' and date = '2026-11-10'), 'two devices, same day: still one row');
select pg_temp.ok((select check_in = '2026-11-10T09:00:00+05:30' and check_out = '2026-11-10T18:00:00+05:30' and duration_minutes = 540
                     from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000a' and date = '2026-11-10'), 'merge keeps earliest in, latest out, recomputes hours');
select pg_temp.ok((select is_late = false from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000a' and date = '2026-11-10'), '09:00 check-in is not late');

select pg_temp.expect_error($$insert into attendance (employee_id, employee_name, company_id, date, marked_by) values ('e0000000-0000-0000-0000-00000000000a', 'Asha', 'aaaaaaaa-0000-0000-0000-000000000000', '2026-11-10', 'face')$$, '23505', 'plain duplicate insert is rejected');

-- late check-in
select pg_temp.claims('a0000000-0000-0000-0000-000000000003');
set role authenticated;
select sync_attendance('{"employee_id":"e0000000-0000-0000-0000-00000000000a","employee_name":"Asha","company_id":"aaaaaaaa-0000-0000-0000-000000000000","date":"2026-11-11","check_in":"2026-11-11T09:20:00+05:30"}'::jsonb);
reset role;
select pg_temp.ok((select is_late from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000a' and date = '2026-11-11'), '09:20 check-in is late (grace 5 min)');

-- auto-absence replaced by a late-arriving offline scan
select mark_daily_absences('2026-11-12');
select pg_temp.ok((select status = 'absent' from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000a' and date = '2026-11-12'), 'cron marks absence');
select pg_temp.claims('a0000000-0000-0000-0000-000000000003');
set role authenticated;
select sync_attendance('{"employee_id":"e0000000-0000-0000-0000-00000000000a","employee_name":"Asha","company_id":"aaaaaaaa-0000-0000-0000-000000000000","date":"2026-11-12","check_in":"2026-11-12T08:55:00+05:30"}'::jsonb);
reset role;
select pg_temp.ok((select status is null and marked_by = 'face' and note is null and check_in is not null
                     from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000a' and date = '2026-11-12'), 'offline scan replaces the auto-absence instead of duplicating');

-- cross-tenant
select pg_temp.claims('b0000000-0000-0000-0000-000000000001');
set role authenticated;
select pg_temp.expect_error($$select sync_attendance('{"employee_id":"e0000000-0000-0000-0000-00000000000a","employee_name":"Asha","company_id":"aaaaaaaa-0000-0000-0000-000000000000","date":"2026-11-13","check_in":"2026-11-13T09:00:00+05:30"}'::jsonb)$$, '42501', 'another company cannot write attendance');
select pg_temp.ok((select count(*) = 0 from attendance where company_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'another company cannot read attendance');
reset role;

select pg_temp.expect_error($$select sync_attendance('{"employee_id":"e0000000-0000-0000-0000-00000000000a","employee_name":"Asha","company_id":"aaaaaaaa-0000-0000-0000-000000000000","date":"2026-11-14","check_in":"2026-11-14T18:00:00+05:30","check_out":"2026-11-14T09:00:00+05:30"}'::jsonb)$$, '22023', 'checkout before check-in rejected');

-- ===================== H5 / H6: clock and geofence =====================
insert into attendance (employee_id, employee_name, company_id, date, marked_by, check_in, check_in_lat, check_in_lng, is_outside_geofence)
values ('e0000000-0000-0000-0000-00000000000c', 'Chetan', 'aaaaaaaa-0000-0000-0000-000000000000', date '2027-01-05', 'face', now() + interval '1 day', 19.2000, 72.9000, false);
select pg_temp.ok((select clock_suspect from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000c' and date = date '2027-01-05'), 'future check-in flagged clock_suspect');
select pg_temp.ok((select is_outside_geofence from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000c' and date = date '2027-01-05'), 'server overrides client geofence flag (14 km away)');
select pg_temp.ok((select server_received_at is not null from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000c' and date = date '2027-01-05'), 'server receipt time recorded');

insert into attendance (employee_id, employee_name, company_id, date, marked_by, check_in, check_in_lat, check_in_lng, is_outside_geofence)
values ('e0000000-0000-0000-0000-00000000000c', 'Chetan', 'aaaaaaaa-0000-0000-0000-000000000000', '2026-11-03', 'face', '2026-11-03T09:00:00+05:30', 19.0763, 72.8780, true);
select pg_temp.ok((select not is_outside_geofence and site_id = 'dddddddd-0000-0000-0000-000000000001' and not clock_suspect
                     from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000c' and date = '2026-11-03'), 'scan 40 m from HQ is inside and gets the site');

-- ===================== H7: audit trail =====================
select pg_temp.claims('a0000000-0000-0000-0000-000000000001');
set role authenticated;
update attendance set note = 'corrected' where employee_id = 'e0000000-0000-0000-0000-00000000000c' and date = '2026-11-03';
select pg_temp.ok((select count(*) >= 1 from attendance_audit where action = 'update' and changed_by = auth.uid() and old_row->>'note' is null and new_row->>'note' = 'corrected'), 'edits are audited with old and new values');
select pg_temp.expect_error($$insert into attendance_audit (attendance_id, company_id, action) values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000000', 'fake')$$, '42501', 'clients cannot write audit rows');
with d as (delete from attendance where company_id = 'aaaaaaaa-0000-0000-0000-000000000000' returning 1)
select pg_temp.ok((select count(*) = 0 from d), 'clients cannot delete attendance');
reset role;
select pg_temp.claims('a0000000-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from attendance_audit), 'view-only partner cannot read the audit log');
reset role;

-- ===================== M5: auto-absence rules =====================
select mark_daily_absences('2026-11-15');  -- a Sunday, the weekly off
select pg_temp.ok((select count(*) = 0 from attendance where date = '2026-11-15' and company_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'no absence on weekly off');
insert into leave_requests (company_id, employee_id, leave_type, start_date, end_date, status)
values ('aaaaaaaa-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-00000000000c', 'casual', '2026-11-17', '2026-11-17', 'approved');
select mark_daily_absences('2026-11-17');
select pg_temp.ok((select status = 'leave' from attendance where employee_id = 'e0000000-0000-0000-0000-00000000000c' and date = '2026-11-17'), 'approved leave marked as leave, not absent');
select mark_daily_absences('2025-12-31');
select pg_temp.ok((select count(*) = 0 from attendance where date = '2025-12-31'), 'no absence before the employee existed');

-- ===================== H8 / H9: storage =====================
select pg_temp.claims('a0000000-0000-0000-0000-000000000001');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('company-logos', 'aaaaaaaa-0000-0000-0000-000000000000/logo.png');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('company-logos', 'bbbbbbbb-0000-0000-0000-000000000000/logo.png')$$, '42501', 'cannot overwrite another company''s logo');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('visit-photos', 'bbbbbbbb-0000-0000-0000-000000000000/v.jpg')$$, '42501', 'cannot upload into another company''s visit photos');
reset role;
insert into storage.objects (bucket_id, name) values ('visit-photos', 'bbbbbbbb-0000-0000-0000-000000000000/v.jpg');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'visit-photos'), 'cannot read another company''s visit photos');
reset role;

-- ===================== crash reports =====================
select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
insert into client_errors (app_version, platform, message) values ('1.1.0', 'android', 'test');
select pg_temp.ok((select count(*) = 0 from client_errors), 'error reports are write-only for clients');
select pg_temp.expect_error($$select current_company_id()$$, '42501', 'anon cannot call current_company_id');
reset role;

\echo 'ALL DATABASE TESTS PASSED'
