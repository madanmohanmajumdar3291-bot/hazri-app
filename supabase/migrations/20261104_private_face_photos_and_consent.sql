-- Face photos are biometric personal data: no public bucket access.
update storage.buckets set public = false where id in ('employee-photos', 'visit-photos');

drop policy if exists "public read employee photos" on storage.objects;
drop policy if exists "authenticated upload employee photos" on storage.objects;
drop policy if exists "authenticated update employee photos" on storage.objects;
drop policy if exists "Anyone can view visit photos" on storage.objects;

-- employee-photos objects live at <employee_id>/photo.<ext>; only members of
-- that employee's company can read or write them.
create policy "company reads own employee photos" on storage.objects for select to authenticated
  using (bucket_id = 'employee-photos' and exists (
    select 1 from public.employees e
    where e.id::text = (storage.foldername(name))[1] and e.company_id = public.current_company_id()));
create policy "company uploads own employee photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-photos' and exists (
    select 1 from public.employees e
    where e.id::text = (storage.foldername(name))[1] and e.company_id = public.current_company_id()));
create policy "company updates own employee photos" on storage.objects for update to authenticated
  using (bucket_id = 'employee-photos' and exists (
    select 1 from public.employees e
    where e.id::text = (storage.foldername(name))[1] and e.company_id = public.current_company_id()));
create policy "company deletes own employee photos" on storage.objects for delete to authenticated
  using (bucket_id = 'employee-photos' and exists (
    select 1 from public.employees e
    where e.id::text = (storage.foldername(name))[1] and e.company_id = public.current_company_id()));

create policy "signed-in users view visit photos" on storage.objects for select to authenticated
  using (bucket_id = 'visit-photos');

-- Record when face-data consent was given (DPDP Act).
alter table public.employees add column if not exists face_consent_at timestamptz;
alter table public.users add column if not exists face_consent_at timestamptz;

-- Not used by the app; stop anonymous phone/username -> email lookups.
revoke execute on function public.get_email_for_username(text) from anon, public;
