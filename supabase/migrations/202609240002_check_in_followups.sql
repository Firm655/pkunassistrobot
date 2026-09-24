-- One caregiver follow-up per answer. The event is a normal button-answer check-in
-- so existing device RLS, offline replay and submit_response validation apply.
begin;

create table public.check_in_followups (
  event_id uuid primary key,
  parent_response_id uuid not null unique,
  organization_id uuid not null,
  patient_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (event_id, patient_id, organization_id)
    references public.care_events(id, patient_id, organization_id),
  foreign key (parent_response_id) references public.patient_responses(id)
);
create index check_in_followups_patient on public.check_in_followups(patient_id, created_at);
alter table public.check_in_followups enable row level security;
revoke all on public.check_in_followups from anon, authenticated;
grant select on public.check_in_followups to authenticated;
create policy staff_read on public.check_in_followups for select to authenticated
  using (private.is_staff(organization_id));

create function private.protect_followup_event() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.check_in_followups where event_id = old.id)
    and (new.title is distinct from old.title or new.payload is distinct from old.payload
      or new.description is distinct from old.description
      or new.patient_id is distinct from old.patient_id
      or new.organization_id is distinct from old.organization_id
      or new.scheduled_date is distinct from old.scheduled_date
      or new.scheduled_time is distinct from old.scheduled_time
      or new.timezone is distinct from old.timezone
      or new.due_at is distinct from old.due_at) then
    raise exception 'Sent follow-up content and schedule cannot be edited';
  end if;
  return new;
end $$;
create trigger protect_followup_event before update on public.care_events
  for each row execute function private.protect_followup_event();
revoke execute on function private.protect_followup_event() from public, anon, authenticated;

create function public.create_check_in_followup(
  parent_response_id uuid, question text, answers text[], concerning_answers text[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source public.patient_responses;
  parent public.care_events;
  existing public.care_events;
  created uuid;
  tz text;
  local_time timestamp;
  normalized_answers text[];
  normalized_concerning text[];
begin
  select * into source from public.patient_responses where id = parent_response_id;
  if not found then raise exception 'Response not found'; end if;
  if not private.is_staff(source.organization_id) then raise exception 'Not authorized'; end if;
  select * into parent from public.care_events where id = source.event_id;
  if parent.event_type <> 'DAILY_CHECK_IN' then raise exception 'Follow-up requires a check-in response'; end if;
  if not exists (select 1 from public.patients where id = source.patient_id and status = 'ACTIVE') then
    raise exception 'Patient is inactive';
  end if;

  question := trim(question);
  select array_agg(trim(a) order by n) into normalized_answers
    from unnest(answers) with ordinality as x(a,n);
  select coalesce(array_agg(trim(a) order by n), '{}') into normalized_concerning
    from unnest(concerning_answers) with ordinality as x(a,n);
  if question is null or normalized_answers is null or length(question) not between 1 and 200
     or array_length(normalized_answers, 1) not between 2 and 5
     or exists(select 1 from unnest(normalized_answers) a where length(a) not between 1 and 80)
     or (select count(distinct a) from unnest(normalized_answers) a) <> array_length(normalized_answers, 1)
     or exists(select 1 from unnest(normalized_concerning) a where not a = any(normalized_answers)) then
    raise exception 'Invalid question or answer choices';
  end if;

  -- Serialize retries/concurrent sends for the same answer. A matching retry returns
  -- the existing event; different content requires an explicit new source answer.
  perform pg_advisory_xact_lock(hashtextextended(parent_response_id::text, 0));
  select e.* into existing from public.check_in_followups f
    join public.care_events e on e.id = f.event_id where f.parent_response_id = source.id;
  if found then
    if existing.title = question and existing.payload->'answers' = to_jsonb(normalized_answers)
       and existing.payload->'concerning_answers' = to_jsonb(normalized_concerning) then
      return existing.id;
    end if;
    raise exception 'A different follow-up already exists for this answer';
  end if;

  select timezone into tz from public.organizations where id = source.organization_id;
  local_time := now() at time zone tz;
  insert into public.care_events (
    organization_id, patient_id, event_type, title, scheduled_date,
    scheduled_time, timezone, due_at, status, payload, created_by
  ) values (
    source.organization_id, source.patient_id, 'DAILY_CHECK_IN', question,
    local_time::date, local_time::time, tz, now() + interval '24 hours', 'PENDING',
    jsonb_build_object('answers', normalized_answers, 'concerning_answers', normalized_concerning,
                       'follow_up', true), auth.uid()
  ) returning id into created;
  insert into public.check_in_followups(event_id, parent_response_id, organization_id, patient_id)
    values(created, source.id, source.organization_id, source.patient_id);
  return created;
end $$;
revoke all on function public.create_check_in_followup(uuid,text,text[],text[]) from public, anon;
grant execute on function public.create_check_in_followup(uuid,text,text[],text[]) to authenticated;
commit;
