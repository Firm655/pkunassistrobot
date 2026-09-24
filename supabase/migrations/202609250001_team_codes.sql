-- Self-registration for caregivers with a team code.
--
-- An administrator generates a team code (8 characters, e.g. "K7QM-4TZP") on Team & settings and shares it with
-- new staff. A new caregiver registers on the dashboard with name, email, password and that code. The browser
-- calls the register-caregiver Edge Function (service role, server side), which:
--   1. check_team_code()  - is the code valid? (wrong codes are counted and rate limited)
--   2. creates a confirmed Auth account with the chosen email and password
--   3. redeem_team_code() - adds the caretaker profile to the code's organization (or the account is deleted)
-- Public sign-ups stay OFF, so nobody can create an account without a valid code. Codes only ever grant the
-- 'caretaker' role; administrators are still promoted with provision_caregiver(). One active code per
-- organization; generating a new code or revoking stops the old one immediately.
begin;

create table public.team_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code_hash text not null,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  uses integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (created_by, organization_id) references public.profiles(id, organization_id)
);
create index team_codes_active_lookup on public.team_codes(code_hash) where not revoked;
create index on public.team_codes(organization_id);
alter table public.team_codes enable row level security;
revoke all on public.team_codes from anon, authenticated;
grant select on public.team_codes to authenticated;
grant all on public.team_codes to service_role;
-- Only the hash is stored, and only administrators can see the rows (expiry, number of uses).
create policy admin_read on public.team_codes for select to authenticated using (private.is_admin(organization_id));

create table private.team_code_attempts (
  id bigint generated always as identity primary key,
  client_key text,
  attempted_at timestamptz not null default now(),
  success boolean not null
);
create index team_code_attempts_time on private.team_code_attempts(attempted_at);
create index team_code_attempts_client on private.team_code_attempts(client_key, attempted_at);
revoke all on private.team_code_attempts from public, anon, authenticated;

create function private.normalize_team_code(code text) returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
create function private.team_code_hash(code text) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(private.normalize_team_code(code), 'UTF8')), 'hex')
$$;

create function public.create_team_code(valid_days integer default 7) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  org uuid; token text := ''; raw bytea; i integer; expiry timestamptz;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I: easy to read aloud and type
begin
  select organization_id into org from public.profiles where id = auth.uid() and role = 'admin';
  if org is null then raise exception 'Administrator required' using errcode = '42501'; end if;
  if valid_days not between 1 and 30 then raise exception 'A team code can be valid for 1 to 30 days'; end if;
  expiry := now() + make_interval(days => valid_days);
  update public.team_codes set revoked = true where organization_id = org and not revoked;
  -- 8 characters x 5 bits from random UUID bytes (skipping the fixed version/variant bytes 6 and 8).
  raw := uuid_send(gen_random_uuid());
  foreach i in array array[0,1,2,3,4,5,10,11] loop
    token := token || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
  end loop;
  insert into public.team_codes(organization_id, code_hash, expires_at, created_by)
    values (org, private.team_code_hash(token), expiry, auth.uid());
  return jsonb_build_object('code', substr(token, 1, 4) || '-' || substr(token, 5, 4), 'expires_at', expiry);
end $$;

create function public.revoke_team_code() returns void
language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  select organization_id into org from public.profiles where id = auth.uid() and role = 'admin';
  if org is null then raise exception 'Administrator required' using errcode = '42501'; end if;
  update public.team_codes set revoked = true where organization_id = org and not revoked;
end $$;

-- Service role only (called by the register-caregiver Edge Function).
create function public.check_team_code(team_code text, client_key text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare valid boolean;
begin
  delete from private.team_code_attempts where attempted_at < now() - interval '1 day';
  if check_team_code.client_key is not null and (select count(*) from private.team_code_attempts a
      where a.client_key = check_team_code.client_key and not a.success and a.attempted_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many wrong team codes. Wait 10 minutes and try again.' using errcode = '42501';
  end if;
  if (select count(*) from private.team_code_attempts a
      where not a.success and a.attempted_at > now() - interval '10 minutes') >= 50 then
    raise exception 'Registration is temporarily paused after repeated wrong codes. Try again in 10 minutes.' using errcode = '42501';
  end if;
  valid := exists(select 1 from public.team_codes t
    where t.code_hash = private.team_code_hash(team_code) and not t.revoked and t.expires_at > now());
  insert into private.team_code_attempts(client_key, success) values (check_team_code.client_key, valid);
  return valid;
end $$;

-- Service role only. Returns the organization id, or null if the code stopped being valid meanwhile.
create function public.redeem_team_code(team_code text, new_user_id uuid, full_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.team_codes; clean_name text := left(trim(coalesce(full_name, '')), 120);
begin
  if length(clean_name) = 0 then raise exception 'Name is required'; end if;
  if not exists(select 1 from auth.users where id = new_user_id) then raise exception 'Account not found'; end if;
  if exists(select 1 from public.profiles where id = new_user_id)
     or exists(select 1 from public.devices where auth_user_id = new_user_id) then
    raise exception 'Not a new caregiver account';
  end if;
  select * into t from public.team_codes tc
    where tc.code_hash = private.team_code_hash(team_code) and not tc.revoked and tc.expires_at > now()
    order by tc.created_at desc limit 1 for update;
  if t.id is null then return null; end if;
  insert into public.profiles(id, organization_id, full_name, role) values (new_user_id, t.organization_id, clean_name, 'caretaker');
  update public.team_codes set uses = uses + 1 where id = t.id;
  insert into public.interaction_logs(organization_id, action, data)
    values (t.organization_id, 'CAREGIVER_REGISTERED', jsonb_build_object('user_id', new_user_id, 'full_name', clean_name));
  return t.organization_id;
end $$;

revoke execute on function private.normalize_team_code(text), private.team_code_hash(text) from public, anon, authenticated;
revoke execute on function public.create_team_code(integer), public.revoke_team_code(),
  public.check_team_code(text, text), public.redeem_team_code(text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_team_code(integer), public.revoke_team_code() to authenticated, service_role;
grant execute on function public.check_team_code(text, text), public.redeem_team_code(text, uuid, text) to service_role;
commit;
