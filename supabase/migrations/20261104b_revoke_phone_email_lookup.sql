-- Run only after the app update that logs in through the phone-login edge
-- function has reached phones; older app versions still call this RPC.
revoke execute on function public.get_email_for_phone(text) from anon, public;
