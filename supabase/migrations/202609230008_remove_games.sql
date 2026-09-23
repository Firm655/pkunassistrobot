-- Games are entirely local to the Raspberry Pi and deliberately have no server record.
begin;

-- The project was checked for related rows before this migration was deployed.
delete from public.care_events where event_type = 'REHABILITATION_GAME';
do $publication$
begin
  if exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_sessions') then
    alter publication supabase_realtime drop table public.game_sessions;
  end if;
end $publication$;
drop table if exists public.game_sessions;
drop table if exists public.game_assignments;
drop table if exists public.games;

alter table public.care_events drop constraint care_events_event_type_check;
alter table public.care_events add constraint care_events_event_type_check
  check (event_type in ('DAILY_CHECK_IN','MEDICINE','TASK','MEAL'));

create or replace function public.submit_response(
  submission_id uuid, patient_id uuid, event_id uuid, response text,
  response_data jsonb default '{}', response_time timestamptz default now()
) returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.devices; e public.care_events; prior public.patient_responses;
  alert_kind text; new_status text := 'COMPLETED';
begin
  d := private.require_device(patient_id);
  select * into e from public.care_events c where c.id = event_id and c.patient_id = submit_response.patient_id for update;
  if e.id is null then raise exception 'Event not available' using errcode = '42501'; end if;
  select * into prior from public.patient_responses r where r.id = submission_id;
  if prior.id is not null then
    if prior.event_id <> event_id or prior.device_id <> d.id or prior.response <> response
      or prior.response_data <> response_data or prior.response_time <> response_time then raise exception 'Idempotency key reused with different content'; end if;
    return prior.id;
  end if;
  if e.status in ('COMPLETED','ALERT','SKIPPED') then raise exception 'Event is already closed'; end if;
  if response_time is null or response_time > now() + interval '5 minutes' or response_time < e.created_at or response_time < e.scheduled_at - interval '5 minutes' then raise exception 'Invalid response timestamp'; end if;
  if response is null or response_data is null or jsonb_typeof(response_data) <> 'object' or pg_column_size(response_data) > 16384 then raise exception 'Invalid response data'; end if;
  if e.event_type in ('MEDICINE','MEAL') then
    if response not in ('YES','NO') then raise exception 'Expected YES or NO'; end if;
    if response = 'NO' then alert_kind := case when e.event_type = 'MEDICINE' then 'MEDICINE_NOT_TAKEN' else 'MEAL_NOT_COMPLETED' end; end if;
  elsif e.event_type = 'DAILY_CHECK_IN' then
    if not ((e.payload->'answers') ? response) then raise exception 'Answer is not one of the configured choices'; end if;
    if coalesce(e.payload->'concerning_answers','[]'::jsonb) ? response then alert_kind := 'CONCERNING_CHECK_IN'; end if;
  elsif e.event_type = 'TASK' then
    if response <> 'DISPLAYED' then raise exception 'Task requires a DISPLAYED receipt'; end if;
  end if;
  if alert_kind is not null then new_status := 'ALERT'; end if;
  insert into public.patient_responses(id,organization_id,patient_id,event_id,device_id,response,response_data,response_time)
    values(submission_id,e.organization_id,e.patient_id,e.id,d.id,response,response_data,response_time);
  update public.care_events set status = new_status, response_data = jsonb_build_object('response',response,'data',submit_response.response_data), completed_at = response_time where id = e.id;
  if alert_kind is not null then insert into public.alerts(organization_id,patient_id,event_id,alert_type,message,priority,dedupe_key)
    values(e.organization_id,e.patient_id,e.id,alert_kind,e.title || ': ' || response,'ATTENTION','response:' || submission_id); end if;
  insert into public.interaction_logs(organization_id,patient_id,device_id,event_id,action,data)
    values(e.organization_id,e.patient_id,d.id,e.id,'PATIENT_RESPONSE',jsonb_build_object('response_id',submission_id,'response',response));
  return submission_id;
end $$;

create or replace function private.materialize_schedules(org uuid, horizon_days integer default 7) returns integer
language plpgsql security definer set search_path = '' as $$
declare t text; row_data jsonb; local_today date; zone text; day date; start_day date; end_day date;
  kind text; event_title text; event_description text; event_payload jsonb; schedule_id uuid; n integer := 0;
begin
  if horizon_days not between 0 and 31 then raise exception 'Horizon must be 0 to 31 days'; end if;
  select timezone into zone from public.organizations where id = org;
  if zone is null then raise exception 'Organization not found'; end if;
  local_today := (now() at time zone zone)::date;
  foreach t in array array['check_in_questions','medicines','meals','tasks'] loop
    for row_data in execute format('select to_jsonb(s) from public.%I s where organization_id = $1',t) using org loop
      schedule_id := (row_data->>'id')::uuid; start_day := (row_data->>'start_date')::date;
      end_day := least(coalesce((row_data->>'end_date')::date,local_today + horizon_days),local_today + horizon_days);
      update public.care_events set status = 'SKIPPED' where organization_id = org and source_table = t and source_id = schedule_id and status in ('SCHEDULED','PENDING') and scheduled_at > now() and (
        not (row_data->>'enabled')::boolean or scheduled_date < start_day or ((row_data->>'end_date') is not null and scheduled_date > (row_data->>'end_date')::date) or (row_data->>'recurrence' = 'ONCE' and scheduled_date <> start_day) or (row_data->>'recurrence' = 'WEEKLY' and (scheduled_date - start_day) % 7 <> 0));
      if not (row_data->>'enabled')::boolean or not exists (select 1 from public.patients where id = (row_data->>'patient_id')::uuid and status = 'ACTIVE') then continue; end if;
      kind := case t when 'check_in_questions' then 'DAILY_CHECK_IN' when 'medicines' then 'MEDICINE' when 'meals' then 'MEAL' else 'TASK' end;
      event_title := coalesce(row_data->>'question',row_data->>'name',row_data->>'title',row_data->>'meal_type'); event_description := coalesce(row_data->>'instructions',row_data->>'description');
      event_payload := case t when 'check_in_questions' then jsonb_build_object('answers',row_data->'answers','concerning_answers',row_data->'concerning_answers') when 'medicines' then jsonb_build_object('name',row_data->>'name','dosage',row_data->>'dosage','instructions',row_data->>'instructions') when 'meals' then jsonb_build_object('meal_type',row_data->>'meal_type') else '{}'::jsonb end;
      for day in select generate_series(greatest(start_day,local_today)::timestamp,end_day::timestamp,interval '1 day')::date loop
        if row_data->>'recurrence' = 'ONCE' and day <> start_day then continue; end if;
        if row_data->>'recurrence' = 'WEEKLY' and (day - start_day) % 7 <> 0 then continue; end if;
        insert into public.care_events(organization_id,patient_id,event_type,title,description,scheduled_date,scheduled_time,timezone,recurrence,source_table,source_id,response_required,payload,created_by)
          values(org,(row_data->>'patient_id')::uuid,kind,event_title,event_description,day,(row_data->>'scheduled_time')::time,zone,row_data->>'recurrence',t,schedule_id,kind <> 'TASK',event_payload,(row_data->>'created_by')::uuid)
          on conflict(source_table,source_id,scheduled_date) do update set title = excluded.title, description = excluded.description, scheduled_time = excluded.scheduled_time, timezone = excluded.timezone, recurrence = excluded.recurrence, payload = excluded.payload where public.care_events.status = 'SCHEDULED' and public.care_events.scheduled_at > now();
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
commit;
