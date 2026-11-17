-- Hazri v1.1.0 follow-up (Supabase security advisor, 2026-11-17).
-- Trigger functions are not meant to be called through the REST API.
-- Postgres checks EXECUTE on a trigger function only when the trigger is
-- created, so revoking it does not stop the triggers from firing.
revoke execute on function public.guard_users_update() from public, anon, authenticated;
revoke execute on function public.audit_attendance() from public, anon, authenticated;
revoke execute on function public.stamp_client_error() from public, anon, authenticated;
revoke execute on function public.attendance_before_write() from public, anon, authenticated;

-- haversine_m is called by attendance_before_write, which runs as the
-- signed-in caller, so authenticated keeps EXECUTE. Pin its search_path.
alter function public.haversine_m(double precision, double precision, double precision, double precision)
  set search_path = public;
revoke execute on function public.haversine_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.haversine_m(double precision, double precision, double precision, double precision) to authenticated;
