-- TEMPLATE ONLY. Replace the UUID with an existing confirmed caregiver auth.users.id.
-- Do not run unchanged. Creates no passwords, emails, invitations or synthetic patients.
begin;
do $$
declare caregiver_id uuid := '00000000-0000-0000-0000-000000000000'; org uuid;
begin
  if caregiver_id = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Set caregiver_id to the confirmed first caregiver Auth UUID before running';
  end if;
  if not exists(select 1 from auth.users where id = caregiver_id and email_confirmed_at is not null) then
    raise exception 'Confirmed caregiver Auth user not found';
  end if;
  if exists(select 1 from public.devices where auth_user_id = caregiver_id) then raise exception 'Cannot provision a device as staff'; end if;
  insert into public.organizations(name,timezone) values('P-kun Care Team','Asia/Bangkok') returning id into org;
  insert into public.profiles(id,organization_id,full_name,role) values(caregiver_id,org,'P-kun Administrator','admin');
end $$;
commit;
