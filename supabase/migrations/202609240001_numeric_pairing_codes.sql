-- Short numeric pairing codes (6 digits, e.g. "482913") that a nurse can type on P-kun's keypad.
--
-- A 6-digit code has only 1,000,000 possibilities, so guessing is prevented by rate limiting instead of length:
--   * a code is single-use and expires after 10 minutes (unchanged);
--   * generating a new code cancels the organization's previous unused code;
--   * each Auth account gets at most 5 wrong guesses per 10 minutes;
--   * across all accounts, at most 30 wrong guesses per 10 minutes before pairing pauses.
-- Worst case, an attacker has 30 guesses against a code that lives 10 minutes: about a 0.003% chance.
--
-- Contract change: pair_device() now RETURNS NULL for a wrong or expired code instead of raising, so the
-- failed attempt can be recorded (an exception would roll the attempt log back). Other failures still raise.
begin;

alter table public.pairing_codes drop constraint if exists pairing_codes_code_hash_key;
create index if not exists pairing_codes_active_lookup on public.pairing_codes(code_hash) where not used;

-- Only administrators (who can create codes anyway) may read pairing-code rows.
drop policy if exists staff_read on public.pairing_codes;
create policy admin_read on public.pairing_codes for select to authenticated using (private.is_admin(organization_id));

create table if not exists private.pairing_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  attempted_at timestamptz not null default now(),
  success boolean not null
);
create index if not exists pairing_attempts_time on private.pairing_attempts(attempted_at);
create index if not exists pairing_attempts_user_time on private.pairing_attempts(user_id, attempted_at);
revoke all on private.pairing_attempts from public, anon, authenticated;

create or replace function public.create_pairing_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare org uuid; token text; expiry timestamptz := now() + interval '10 minutes'; tries int := 0;
begin
  select organization_id into org from public.profiles where id = auth.uid() and role = 'admin';
  if org is null then raise exception 'Administrator required' using errcode = '42501'; end if;
  -- One active code per organization.
  update public.pairing_codes set used = true where organization_id = org and not used;
  loop
    -- 56 random bits from gen_random_uuid() (a CSPRNG), reduced to 6 digits.
    token := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint) % 1000000)::text, 6, '0');
    exit when not exists(select 1 from public.pairing_codes
      where code_hash = encode(sha256(convert_to(token,'UTF8')),'hex') and not used and expires_at > now());
    tries := tries + 1;
    if tries > 20 then raise exception 'Could not allocate a pairing code, try again'; end if;
  end loop;
  insert into public.pairing_codes(organization_id,code_hash,expires_at,created_by)
    values(org,encode(sha256(convert_to(token,'UTF8')),'hex'),expiry,auth.uid());
  return jsonb_build_object('code',token,'expires_at',expiry);
end $$;

create or replace function public.pair_device(pairing_code text, device_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.pairing_codes; result uuid; normalized text;
begin
  if auth.uid() is null or exists(select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Use a dedicated device Auth account' using errcode = '42501';
  end if;
  if exists(select 1 from public.devices where auth_user_id = auth.uid()) then
    raise exception 'This account is already registered';
  end if;
  delete from private.pairing_attempts where attempted_at < now() - interval '1 day';
  if (select count(*) from private.pairing_attempts
      where user_id = auth.uid() and not success and attempted_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many wrong codes. Wait 10 minutes and try again.' using errcode = '42501';
  end if;
  if (select count(*) from private.pairing_attempts
      where not success and attempted_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Pairing is temporarily paused after repeated wrong codes. Try again in 10 minutes.' using errcode = '42501';
  end if;

  normalized := regexp_replace(coalesce(pairing_code,''), '[^0-9]', '', 'g'); -- accepts "482 913" or "482-913"
  select * into c from public.pairing_codes
    where code_hash = encode(sha256(convert_to(normalized,'UTF8')),'hex') and not used and expires_at > now()
    order by created_at desc limit 1 for update;
  if c.id is null then
    insert into private.pairing_attempts(user_id, success) values (auth.uid(), false);
    return null; -- wrong or expired code; the attempt above is kept
  end if;

  insert into public.devices(organization_id,auth_user_id,device_name)
    values(c.organization_id,auth.uid(),device_name) returning id into result;
  update public.pairing_codes set used = true where id = c.id;
  insert into private.pairing_attempts(user_id, success) values (auth.uid(), true);
  insert into public.interaction_logs(organization_id,device_id,action) values(c.organization_id,result,'DEVICE_PAIRED');
  return result;
end $$;

revoke execute on function public.create_pairing_code(), public.pair_device(text,text) from public, anon, authenticated;
grant execute on function public.create_pairing_code(), public.pair_device(text,text) to authenticated, service_role;
commit;
