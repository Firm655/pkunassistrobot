begin;
create function private.materialize_schedules(org uuid, horizon_days integer default 7) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t text; row_data jsonb; local_today date; zone text; day date; start_day date; end_day date;
  kind text; event_title text; event_description text; event_payload jsonb; schedule_id uuid;
  n integer := 0;
begin
  if horizon_days not between 0 and 31 then raise exception 'Horizon must be 0 to 31 days'; end if;
  select timezone into zone from public.organizations where id = org;
  if zone is null then raise exception 'Organization not found'; end if;
  local_today := (now() at time zone zone)::date;
  foreach t in array array['check_in_questions','medicines','meals','tasks'] loop
    for row_data in execute format('select to_jsonb(s) from public.%I s where organization_id = $1',t) using org loop
      schedule_id := (row_data->>'id')::uuid;
      start_day := (row_data->>'start_date')::date;
      end_day := least(coalesce((row_data->>'end_date')::date,local_today + horizon_days),local_today + horizon_days);
      -- Cancel future occurrences removed by edits/disablement. Preserve completed history.
      update public.care_events set status = 'SKIPPED'
        where organization_id = org and source_table = t and source_id = schedule_id
        and status in ('SCHEDULED','PENDING') and scheduled_at > now() and (
          not (row_data->>'enabled')::boolean or scheduled_date < start_day
          or ((row_data->>'end_date') is not null and scheduled_date > (row_data->>'end_date')::date)
          or (row_data->>'recurrence' = 'ONCE' and scheduled_date <> start_day)
          or (row_data->>'recurrence' = 'WEEKLY' and (scheduled_date - start_day) % 7 <> 0));
      if not (row_data->>'enabled')::boolean or not exists (
        select 1 from public.patients where id = (row_data->>'patient_id')::uuid and status = 'ACTIVE'
      ) then continue; end if;
      kind := case t when 'check_in_questions' then 'DAILY_CHECK_IN' when 'medicines' then 'MEDICINE'
        when 'meals' then 'MEAL' else 'TASK' end;
      event_title := coalesce(row_data->>'question',row_data->>'name',row_data->>'title',row_data->>'meal_type');
      event_description := coalesce(row_data->>'instructions',row_data->>'description');
      -- Allowlist patient-facing fields; never copy an entire patient or configuration row.
      event_payload := case t
        when 'check_in_questions' then jsonb_build_object('answers',row_data->'answers','concerning_answers',row_data->'concerning_answers')
        when 'medicines' then jsonb_build_object('name',row_data->>'name','dosage',row_data->>'dosage','instructions',row_data->>'instructions')
        when 'meals' then jsonb_build_object('meal_type',row_data->>'meal_type')
        else '{}'::jsonb end;
      for day in select generate_series(greatest(start_day,local_today)::timestamp,end_day::timestamp,interval '1 day')::date loop
        if row_data->>'recurrence' = 'ONCE' and day <> start_day then continue; end if;
        if row_data->>'recurrence' = 'WEEKLY' and (day - start_day) % 7 <> 0 then continue; end if;
        insert into public.care_events(organization_id,patient_id,event_type,title,description,scheduled_date,scheduled_time,timezone,recurrence,source_table,source_id,response_required,payload,created_by)
          values(org,(row_data->>'patient_id')::uuid,kind,event_title,event_description,day,(row_data->>'scheduled_time')::time,zone,row_data->>'recurrence',t,schedule_id,kind <> 'TASK',event_payload,(row_data->>'created_by')::uuid)
          on conflict(source_table,source_id,scheduled_date) do update set
            title = excluded.title, description = excluded.description, scheduled_time = excluded.scheduled_time,
            timezone = excluded.timezone, recurrence = excluded.recurrence, payload = excluded.payload
          where public.care_events.status = 'SCHEDULED' and public.care_events.scheduled_at > now();
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;

create function public.refresh_schedules(horizon_days integer default 7) returns integer
language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  select organization_id into org from public.profiles where id = auth.uid();
  if org is null then raise exception 'Caregiver required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('pkun_schedule'),hashtext(org::text));
  return private.materialize_schedules(org,horizon_days);
end $$;

create function public.run_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o record; e public.care_events; d public.devices; missed integer := 0; offline integer := 0;
begin
  -- EXECUTE is granted only to service_role and the owner (cron), never client roles.
  if not pg_try_advisory_xact_lock(hashtext('pkun_maintenance')) then return '{"busy":true}'::jsonb; end if;
  for o in select id from public.organizations loop
    perform pg_advisory_xact_lock(hashtext('pkun_schedule'),hashtext(o.id::text));
    perform private.materialize_schedules(o.id,7);
  end loop;
  update public.care_events set status = 'PENDING' where status = 'SCHEDULED' and scheduled_at <= now();
  for e in select * from public.care_events where status in ('SCHEDULED','PENDING') and due_at < now() for update skip locked loop
    update public.care_events set status = 'MISSED' where id = e.id;
    insert into public.alerts(organization_id,patient_id,event_id,alert_type,message,priority,dedupe_key)
      values(e.organization_id,e.patient_id,e.id,'MISSED_EVENT','No response or display receipt: ' || e.title,'ATTENTION','missed:' || e.id)
      on conflict(dedupe_key) do nothing;
    insert into public.interaction_logs(organization_id,patient_id,event_id,action) values(e.organization_id,e.patient_id,e.id,'EVENT_MISSED');
    missed := missed + 1;
  end loop;
  for d in select * from public.devices where revoked_at is null and assigned_patient_id is not null
    and status <> 'OFFLINE' and coalesce(last_seen,created_at) < now() - interval '3 minutes' for update skip locked loop
    update public.devices set status = 'OFFLINE' where id = d.id;
    insert into public.alerts(organization_id,patient_id,device_id,alert_type,message,priority,dedupe_key)
      values(d.organization_id,d.assigned_patient_id,d.id,'DEVICE_OFFLINE',d.device_name || ' has not sent a heartbeat for 3 minutes','ATTENTION',
        'offline:' || d.id || ':' || coalesce(d.last_seen,d.created_at)::text)
      on conflict(dedupe_key) do nothing;
    offline := offline + 1;
  end loop;
  return jsonb_build_object('missed',missed,'offline',offline);
end $$;
revoke execute on function private.materialize_schedules(uuid,integer) from public, anon, authenticated;
revoke execute on function public.refresh_schedules(integer) from public, anon, authenticated;
grant execute on function public.refresh_schedules(integer) to authenticated;
revoke execute on function public.run_maintenance() from public, anon, authenticated;
grant execute on function public.run_maintenance() to service_role;
commit;
