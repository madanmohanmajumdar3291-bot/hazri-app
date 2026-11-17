-- Critical-error alerts over WhatsApp (CallMeBot).
-- Every 15 minutes pg_cron calls the error-alerts edge function, which sends
-- one WhatsApp summary if any crash or unsyncable attendance was reported.
-- Settings live in Supabase Vault, never in the repo. Before running, replace:
--   __ALERT_CRON_SECRET__   a long random string
--   __WHATSAPP_PHONE__      your number with country code, digits only (91...)
--   __CALLMEBOT_APIKEY__    the key CallMeBot sends you on WhatsApp
create extension if not exists pg_net with schema extensions;

delete from vault.secrets where name in ('alert_cron_secret', 'alert_whatsapp_phone', 'alert_callmebot_apikey');
select vault.create_secret('__ALERT_CRON_SECRET__', 'alert_cron_secret');
select vault.create_secret('__WHATSAPP_PHONE__', 'alert_whatsapp_phone');
select vault.create_secret('__CALLMEBOT_APIKEY__', 'alert_callmebot_apikey');

-- Read by the edge function with the service role only.
create or replace function public.get_alert_config()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_object_agg(name, decrypted_secret)
  from vault.decrypted_secrets
  where name in ('alert_cron_secret', 'alert_whatsapp_phone', 'alert_callmebot_apikey');
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
