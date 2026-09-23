begin;
-- Security-definer entry points have fixed search paths and explicit caller checks.
create function private.require_device(expected_patient uuid default null)
returns public.devices language plpgsql security definer set search_path = '' as $$
declare d public.devices;
begin
  select * into d from public.devices where auth_user_id = auth.uid() and revoked_at is null for update;
  if d.id is null then raise exception 'Device authentication required' using errcode = '42501'; end if;
  if expected_patient is not null and (d.assigned_patient_id is distinct from expected_patient or not exists(
    select 1 from public.patients where id = expected_patient and status = 'ACTIVE'
  )) then raise exception 'Patient assignment is no longer valid' using errcode = '42501'; end if;
  return d;
end $$;

create function public.create_pairing_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare org uuid; token text := gen_random_uuid()::text; expiry timestamptz := now() + interval '10 minutes';
begin
  select organization_id into org from public.profiles where id = auth.uid() and role = 'admin';
  if org is null then raise exception 'Administrator required' using errcode = '42501'; end if;
  insert into public.pairing_codes(organization_id,code_hash,expires_at,created_by)
    values(org,encode(sha256(convert_to(token,'UTF8')),'hex'),expiry,auth.uid());
  return jsonb_build_object('code',token,'expires_at',expiry);
end $$;

create function public.pair_device(pairing_code text, device_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.pairing_codes; result uuid;
begin
  if auth.uid() is null or exists(select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Use a dedicated device Auth account' using errcode = '42501';
  end if;
  if exists(select 1 from public.devices where auth_user_id = auth.uid()) then
    raise exception 'This account is already registered';
  end if;
  select * into c from public.pairing_codes
    where code_hash = encode(sha256(convert_to(pairing_code,'UTF8')),'hex') for update;
  if c.id is null or c.used or c.expires_at <= now() then raise exception 'Invalid or expired pairing code'; end if;
  insert into public.devices(organization_id,auth_user_id,device_name)
    values(c.organization_id,auth.uid(),device_name) returning id into result;
  update public.pairing_codes set used = true where id = c.id;
  insert into public.interaction_logs(organization_id,device_id,action) values(c.organization_id,result,'DEVICE_PAIRED');
  return result;
end $$;

create function public.device_context() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.devices; result jsonb;
begin
  d := private.require_device();
  select jsonb_build_object('device_id',d.id,'patient_id',p.id,'patient_name',p.name,'timezone',o.timezone)
    into result from public.patients p join public.organizations o on o.id = p.organization_id
    where p.id = d.assigned_patient_id and p.status = 'ACTIVE';
  return coalesce(result,jsonb_build_object('device_id',d.id,'patient_id',null));
end $$;

create function public.device_heartbeat(app_version text, capabilities jsonb default '{}') returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare d public.devices;
begin
  d := private.require_device();
  if length(app_version) > 100 or jsonb_typeof(capabilities) is distinct from 'object' or pg_column_size(capabilities) > 10000 then
    raise exception 'Invalid heartbeat';
  end if;
  if d.last_seen is null or d.last_seen <= now() - interval '30 seconds' then
    update public.devices set last_seen = now(), app_version = device_heartbeat.app_version,
      capabilities = device_heartbeat.capabilities,
      status = case when assigned_patient_id is null then 'PAIRING' else 'ONLINE' end where id = d.id;
    return now();
  end if;
  return d.last_seen;
end $$;

create function public.submit_response(
  submission_id uuid, patient_id uuid, event_id uuid, response text,
  response_data jsonb default '{}', response_time timestamptz default now()
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.devices; e public.care_events; prior public.patient_responses;
  alert_kind text; new_status text := 'COMPLETED';
begin
  d := private.require_device(patient_id);
  select * into e from public.care_events c where c.id = event_id and c.patient_id = submit_response.patient_id for update;
  if e.id is null then raise exception 'Event not available' using errcode = '42501'; end if;
  select * into prior from public.patient_responses r where r.id = submission_id;
  if prior.id is not null then
    if prior.event_id <> event_id or prior.device_id <> d.id or prior.response <> response
      or prior.response_data <> response_data or prior.response_time <> response_time then
      raise exception 'Idempotency key reused with different content';
    end if;
    return prior.id;
  end if;
  if e.status in ('COMPLETED','ALERT','SKIPPED') then raise exception 'Event is already closed'; end if;
  if response_time is null or response_time > now() + interval '5 minutes' or response_time < e.created_at
    or response_time < e.scheduled_at - interval '5 minutes' then raise exception 'Invalid response timestamp'; end if;
  if response is null or response_data is null or jsonb_typeof(response_data) <> 'object' or pg_column_size(response_data) > 16384 then
    raise exception 'Invalid response data';
  end if;
  if e.event_type in ('MEDICINE','MEAL') then
    if response not in ('YES','NO') then raise exception 'Expected YES or NO'; end if;
    if response = 'NO' then
      alert_kind := case when e.event_type = 'MEDICINE' then 'MEDICINE_NOT_TAKEN' else 'MEAL_NOT_COMPLETED' end;
    end if;
  elsif e.event_type = 'DAILY_CHECK_IN' then
    if not ((e.payload->'answers') ? response) then raise exception 'Answer is not one of the configured choices'; end if;
    if coalesce(e.payload->'concerning_answers','[]'::jsonb) ? response then alert_kind := 'CONCERNING_CHECK_IN'; end if;
  elsif e.event_type = 'TASK' then
    if response <> 'DISPLAYED' then raise exception 'Task requires a DISPLAYED receipt'; end if;
  end if;
  if alert_kind is not null then new_status := 'ALERT'; end if;
  insert into public.patient_responses(id,organization_id,patient_id,event_id,device_id,response,response_data,response_time)
    values(submission_id,e.organization_id,e.patient_id,e.id,d.id,response,response_data,response_time);
  update public.care_events set status = new_status, response_data = jsonb_build_object('response',response,'data',submit_response.response_data),
    completed_at = response_time where id = e.id;
  if alert_kind is not null then
    insert into public.alerts(organization_id,patient_id,event_id,alert_type,message,priority,dedupe_key)
      values(e.organization_id,e.patient_id,e.id,alert_kind,e.title || ': ' || response,'ATTENTION','response:' || submission_id);
  end if;
  insert into public.interaction_logs(organization_id,patient_id,device_id,event_id,action,data)
    values(e.organization_id,e.patient_id,d.id,e.id,'PATIENT_RESPONSE',jsonb_build_object('response_id',submission_id,'response',response));
  return submission_id;
end $$;

create function public.send_patient_request(submission_id uuid, patient_id uuid, request_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.devices; prior public.messages; body text; kind text;
begin
  d := private.require_device(patient_id);
  body := case request_code when 'HELP' then 'I need help' when 'HUNGRY' then 'I''m hungry' when 'NOT_RIGHT' then 'Something isn''t right' end;
  if body is null then raise exception 'Unknown preset request'; end if;
  select * into prior from public.messages where id = submission_id;
  if prior.id is not null then
    if prior.sender_id <> auth.uid() or prior.patient_id <> patient_id or prior.request_code is distinct from request_code then
      raise exception 'Idempotency key reused with different content';
    end if;
    return prior.id;
  end if;
  insert into public.messages(id,organization_id,patient_id,sender_type,sender_id,message_type,message,request_code)
    values(submission_id,d.organization_id,patient_id,'PATIENT',auth.uid(),'PATIENT_REQUEST',body,request_code);
  kind := case request_code when 'HELP' then 'PATIENT_HELP_REQUEST' when 'NOT_RIGHT' then 'PATIENT_SOMETHING_WRONG' end;
  if kind is not null then
    insert into public.alerts(organization_id,patient_id,device_id,alert_type,message,priority,dedupe_key)
      values(d.organization_id,patient_id,d.id,kind,body,'HIGH','request:' || submission_id);
  end if;
  insert into public.interaction_logs(organization_id,patient_id,device_id,action,data)
    values(d.organization_id,patient_id,d.id,'PATIENT_REQUEST',jsonb_build_object('message_id',submission_id,'request_code',request_code));
  return submission_id;
end $$;

create function public.send_caregiver_message(submission_id uuid, patient_id uuid, message text, message_type text default 'CUSTOM') returns uuid
language plpgsql security definer set search_path = '' as $$
declare org uuid; prior public.messages;
begin
  select organization_id into org from public.patients p where p.id = patient_id;
  if not coalesce(private.is_staff(org),false) then raise exception 'Caregiver required' using errcode = '42501'; end if;
  if message_type not in ('CUSTOM','PRESET') then raise exception 'Invalid caregiver message type'; end if;
  select * into prior from public.messages where id = submission_id;
  if prior.id is not null then
    if prior.sender_id <> auth.uid() or prior.patient_id <> patient_id or prior.message <> message or prior.message_type <> message_type then
      raise exception 'Idempotency key reused with different content';
    end if;
    return prior.id;
  end if;
  insert into public.messages(id,organization_id,patient_id,sender_type,sender_id,message_type,message)
    values(submission_id,org,patient_id,'CARETAKER',auth.uid(),message_type,message);
  insert into public.interaction_logs(organization_id,patient_id,action,data)
    values(org,patient_id,'CAREGIVER_MESSAGE',jsonb_build_object('message_id',submission_id));
  return submission_id;
end $$;

create function public.acknowledge_message(message_id uuid, patient_id uuid, acknowledged boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.devices; m public.messages;
begin
  d := private.require_device(patient_id);
  select * into m from public.messages where id = message_id for update;
  if m.id is null or m.patient_id <> patient_id or m.sender_type <> 'CARETAKER' then
    raise exception 'Message not available' using errcode = '42501';
  end if;
  update public.messages set delivered_at = coalesce(delivered_at,now()),
    acknowledged_at = case when acknowledged then coalesce(acknowledged_at,now()) else acknowledged_at end where id = message_id;
  if acknowledged and m.acknowledged_at is null then
    insert into public.interaction_logs(organization_id,patient_id,device_id,action,data)
      values(d.organization_id,patient_id,d.id,'MESSAGE_ACKNOWLEDGED',jsonb_build_object('message_id',message_id));
  end if;
end $$;

create function public.review_alert(alert_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = alert_id for update;
  if not coalesce(private.is_staff(a.organization_id),false) then raise exception 'Caregiver required' using errcode = '42501'; end if;
  if not a.reviewed then
    update public.alerts set reviewed = true, reviewed_by = auth.uid(), reviewed_at = now() where id = alert_id;
    insert into public.interaction_logs(organization_id,patient_id,event_id,action,data)
      values(a.organization_id,a.patient_id,a.event_id,'ALERT_REVIEWED',jsonb_build_object('alert_id',alert_id,'reviewed_by',auth.uid()));
  end if;
end $$;

-- Provisioning is explicit: ordinary signups and device accounts gain no staff permissions.
create function public.provision_caregiver(user_id uuid, organization_id uuid, full_name text, role text default 'caretaker') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(organization_id) and coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if exists(select 1 from public.devices where auth_user_id = user_id) then raise exception 'Device accounts cannot become caregivers'; end if;
  insert into public.profiles(id,organization_id,full_name,role) values(user_id,organization_id,full_name,role);
end $$;

-- Explicit execute grants prevent anonymous or device access to administrative functions.
revoke execute on function private.require_device(uuid) from public, anon, authenticated;
do $grants$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_pairing_code','pair_device','device_context','device_heartbeat','submit_response','send_patient_request','send_caregiver_message','acknowledge_message','review_alert','provision_caregiver') loop
    execute format('revoke execute on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to authenticated, service_role',f.signature);
  end loop;
end $grants$;
commit;
