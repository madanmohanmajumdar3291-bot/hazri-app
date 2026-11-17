-- Critical-error alerts by email (Hostinger Mail API, info@ mailbox).
-- Every 15 minutes pg_cron calls the error-alerts edge function, which sends
-- one email summary if any crash or unsyncable attendance was reported.
-- Settings live in Supabase Vault, never in the repo. Before running, replace:
--   __ALERT_CRON_SECRET__   a long random string
--   __ALERT_EMAIL__         the address alerts go to
--   __MAILBOX_ID__          Hostinger mailbox resource id of the sending mailbox (AC...)
--   __MAIL_TOKEN__          Hostinger Mail API token scoped to that mailbox
create extension if not exists pg_net with schema extensions;

delete from vault.secrets where name like 'alert\_%';
select vault.create_secret('__ALERT_CRON_SECRET__', 'alert_cron_secret');
select vault.create_secret('__ALERT_EMAIL__', 'alert_email');
select vault.create_secret('__MAILBOX_ID__', 'alert_mailbox_id');
select vault.create_secret('__MAIL_TOKEN__', 'alert_mail_token');

-- Read by the edge function with the service role only.
create or replace function public.get_alert_config()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_object_agg(name, decrypted_secret)
  from vault.decrypted_secrets
  where name in ('alert_cron_secret', 'alert_email', 'alert_mailbox_id', 'alert_mail_token');
$$;
revoke execute on function public.get_alert_config() from public, anon, authenticated;
grant execute on function public.get_alert_config() to service_role;

select cron.unschedule('hazri-error-alerts')
where exists (select 1 from cron.job where jobname = 'hazri-error-alerts');

select cron.schedule(
  'hazri-error-alerts',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://ckmqbhrmcdeksauejnlp.supabase.co/functions/v1/error-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alert-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alert_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);
