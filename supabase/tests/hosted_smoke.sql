-- Run as postgres in SQL Editor. All synthetic fixtures are rolled back.
begin;
do $smoke$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  caregiver uuid := gen_random_uuid(); other_caregiver uuid := gen_random_uuid();
  device_user uuid := gen_random_uuid(); patient uuid := gen_random_uuid();
  other_patient uuid := gen_random_uuid(); event uuid := gen_random_uuid();
  device uuid; token text; response_id uuid := gen_random_uuid(); response_at timestamptz := now();
  message_id uuid := gen_random_uuid(); n integer; result jsonb;
begin
  insert into auth.users(id) values(caregiver),(other_caregiver),(device_user);
  insert into public.organizations(id,name) values(org,'ROLLBACK TEST A'),(other_org,'ROLLBACK TEST B');
  insert into public.profiles(id,organization_id,full_name,role)
    values(caregiver,org,'Synthetic caregiver','admin'),(other_caregiver,other_org,'Synthetic other','admin');
  insert into public.patients(id,organization_id,name,other_notes)
    values(patient,org,'Synthetic patient','NEVER_DEVICE_VISIBLE'),(other_patient,other_org,'Synthetic other patient','PRIVATE');
  perform set_config('request.jwt.claim.sub',caregiver::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  select count(*) into n from public.patients;
  if n <> 1 then raise exception 'FAIL: organization isolation'; end if;
  token := public.create_pairing_code()->>'code';
  insert into public.care_events(id,organization_id,patient_id,event_type,title,scheduled_date,scheduled_time,timezone)
    values(event,org,patient,'MEDICINE','Synthetic demo only',(now() at time zone 'UTC')::date,(now() at time zone 'UTC')::time,'UTC');
  perform public.send_caregiver_message(message_id,patient,'Synthetic test message');
  perform set_config('request.jwt.claim.sub',device_user::text,true);
  device := public.pair_device(token,'Synthetic Pi');
  perform set_config('request.jwt.claim.sub',caregiver::text,true);
  update public.devices set assigned_patient_id = patient where id = device;
  perform set_config('request.jwt.claim.sub',device_user::text,true);
  select count(*) into n from public.patients;
  if n <> 0 then raise exception 'FAIL: device can read patient notes'; end if;
  result := public.device_context();
  if result->>'patient_id' <> patient::text or result::text like '%NEVER_DEVICE_VISIBLE%' then
    raise exception 'FAIL: device context';
  end if;
  perform public.submit_response(response_id,patient,event,'NO','{}',response_at);
  perform public.submit_response(response_id,patient,event,'NO','{}',response_at);
  perform public.acknowledge_message(message_id,patient);
  begin
    perform public.acknowledge_message(message_id,null);
    raise exception 'FAIL: null assignment accepted';
  exception when insufficient_privilege then null; end;
  perform public.send_patient_request(gen_random_uuid(),patient,'HELP');
  perform public.device_heartbeat('smoke-test');
  begin
    perform public.run_maintenance();
    raise exception 'FAIL: device can invoke maintenance';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',caregiver::text,true);
  select count(*) into n from public.patient_responses where event_id = event;
  if n <> 1 then raise exception 'FAIL: duplicate response'; end if;
  select count(*) into n from public.alerts where patient_id = patient;
  if n <> 2 then raise exception 'FAIL: response/request alerts'; end if;
  if (select status from public.care_events where id = event) <> 'ALERT' then raise exception 'FAIL: event status'; end if;
  if (select acknowledged_at from public.messages where id = message_id) is null then raise exception 'FAIL: message acknowledgement'; end if;
  execute 'reset role';
end $smoke$;
rollback;
select 'PASS: hosted caregiver/device loop, isolation, idempotency, messages and alerts; all fixtures rolled back' as result;
