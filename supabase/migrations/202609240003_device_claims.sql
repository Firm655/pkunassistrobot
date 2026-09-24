-- Server-side device pairing, no email account per P-kun.
--
-- The Pi sends only the 6-digit pairing code to the claim-device Edge Function. The function (service role,
-- server side) calls check_pairing_code(); only for a valid code does it create a confirmed Auth account with
-- an internal, never-emailed address and a random password, then calls redeem_pairing_code() to consume the
-- code and register the device atomically. Anonymous sign-ins and public sign-ups stay off; wrong codes create
-- nothing. Both functions are callable only with the service role (never by the Pi or a browser directly).
--
-- Rate limits (same numbers as pair_device): 5 wrong codes per client (IP address) per 10 minutes, and
-- 30 wrong codes per 10 minutes in total. pair_device() keeps working for Pis that use an email account.
begin;

alter table private.pairing_attempts alter column user_id drop not null;
alter table private.pairing_attempts add column if not exists client_key text;
create index if not exists pairing_attempts_client_time on private.pairing_attempts(client_key, attempted_at);

create or replace function public.check_pairing_code(pairing_code text, client_key text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare normalized text := regexp_replace(coalesce(pairing_code, ''), '[^0-9]', '', 'g'); valid boolean;
begin
  delete from private.pairing_attempts where attempted_at < now() - interval '1 day';
  if check_pairing_code.client_key is not null and (select count(*) from private.pairing_attempts a
      where a.client_key = check_pairing_code.client_key and not a.success
        and a.attempted_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many wrong codes. Wait 10 minutes and try again.' using errcode = '42501';
  end if;
  if (select count(*) from private.pairing_attempts a
      where not a.success and a.attempted_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Pairing is temporarily paused after repeated wrong codes. Try again in 10 minutes.'
      using errcode = '42501';
  end if;
  valid := exists(select 1 from public.pairing_codes c
    where c.code_hash = encode(sha256(convert_to(normalized, 'UTF8')), 'hex') and not c.used and c.expires_at > now());
  if not valid then
    insert into private.pairing_attempts(user_id, client_key, success) values (null, check_pairing_code.client_key, false);
  end if;
  return valid;
end $$;

create or replace function public.redeem_pairing_code(pairing_code text, device_user_id uuid, device_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.pairing_codes; result uuid; normalized text := regexp_replace(coalesce(pairing_code, ''), '[^0-9]', '', 'g');
begin
  if not exists(select 1 from auth.users where id = device_user_id) then
    raise exception 'Device account not found';
  end if;
  if exists(select 1 from public.profiles where id = device_user_id)
     or exists(select 1 from public.devices where auth_user_id = device_user_id) then
    raise exception 'Not a new device account';
  end if;
  select * into c from public.pairing_codes pc
    where pc.code_hash = encode(sha256(convert_to(normalized, 'UTF8')), 'hex') and not pc.used and pc.expires_at > now()
    order by pc.created_at desc limit 1 for update;
  if c.id is null then
    return null;  -- used or expired in the meantime; the Edge Function deletes the account it just created
  end if;
  insert into public.devices(organization_id, auth_user_id, device_name)
    values (c.organization_id, device_user_id, left(coalesce(nullif(trim(device_name), ''), 'P-kun'), 100))
    returning id into result;
  update public.pairing_codes set used = true where id = c.id;
  insert into private.pairing_attempts(user_id, client_key, success) values (device_user_id, null, true);
  insert into public.interaction_logs(organization_id, device_id, action) values (c.organization_id, result, 'DEVICE_PAIRED');
  return result;
end $$;

revoke all on function public.check_pairing_code(text, text) from public, anon, authenticated;
revoke all on function public.redeem_pairing_code(text, uuid, text) from public, anon, authenticated;
grant execute on function public.check_pairing_code(text, text) to service_role;
grant execute on function public.redeem_pairing_code(text, uuid, text) to service_role;

commit;
