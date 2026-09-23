-- P-kun prototype. No patient/clinical data is seeded by migrations.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  timezone text not null default 'Asia/Bangkok',
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id),
  organization_id uuid not null references public.organizations(id),
  full_name text not null,
  role text not null check (role in ('admin','caretaker')),
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 200),
  date_of_birth date,
  age integer check (age between 0 and 130),
  profile_photo text,
  assigned_caretaker_id uuid,
  emergency_contact jsonb not null default '{}' check (jsonb_typeof(emergency_contact) = 'object'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  special_requirements text, dietary_requirements text, food_restrictions text,
  allergies text, mobility_notes text, communication_preferences text,
  behavioral_notes text, other_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, organization_id),
  foreign key (assigned_caretaker_id, organization_id) references public.profiles(id, organization_id)
);
comment on table public.patients is 'Caregiver-only: devices have no SELECT access to any patient column, including notes.';

create table public.games (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null, description text, game_type text not null,
  active boolean not null default true,
  unique(id, organization_id)
);
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  auth_user_id uuid not null unique references auth.users(id),
  device_name text not null check (length(trim(device_name)) between 1 and 100),
  device_type text not null default 'P_KUN',
  assigned_patient_id uuid,
  status text not null default 'PAIRING' check (status in ('ONLINE','OFFLINE','PAIRING')),
  last_seen timestamptz, app_version text,
  capabilities jsonb not null default '{}' check (jsonb_typeof(capabilities) = 'object'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id, organization_id),
  foreign key (assigned_patient_id, organization_id) references public.patients(id, organization_id)
);
create unique index one_active_device_per_patient on public.devices(assigned_patient_id)
  where assigned_patient_id is not null and revoked_at is null;
create table public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code_hash text not null unique,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key(created_by, organization_id) references public.profiles(id, organization_id)
);

create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  patient_id uuid not null,
  event_type text not null check (event_type in ('DAILY_CHECK_IN','MEDICINE','TASK','MEAL','REHABILITATION_GAME')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text,
  scheduled_date date not null, scheduled_time time not null,
  timezone text not null default 'Asia/Bangkok',
  scheduled_at timestamptz not null,
  due_at timestamptz not null,
  recurrence text not null default 'ONCE' check (recurrence in ('ONCE','DAILY','WEEKLY')),
  source_table text, source_id uuid,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','PENDING','COMPLETED','MISSED','ALERT','SKIPPED')),
  response_required boolean not null default true,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  response_data jsonb not null default '{}' check (jsonb_typeof(response_data) = 'object'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(id, patient_id, organization_id), unique(id, organization_id),
  unique(source_table, source_id, scheduled_date),
  foreign key(patient_id, organization_id) references public.patients(id, organization_id),
  foreign key(created_by, organization_id) references public.profiles(id, organization_id),
  check (due_at > scheduled_at),
  check ((source_table is null) = (source_id is null))
);
comment on column public.care_events.payload is 'Patient-facing content ONLY. No automatic copying of patient notes.';

create table public.patient_responses (
  id uuid primary key, -- client-generated idempotency key persisted in the device outbox
  organization_id uuid not null,
  patient_id uuid not null, event_id uuid not null unique,
  device_id uuid not null, response text not null,
  response_data jsonb not null default '{}',
  response_time timestamptz not null, received_at timestamptz not null default now(),
  foreign key(event_id,patient_id,organization_id) references public.care_events(id,patient_id,organization_id),
  foreign key(device_id,organization_id) references public.devices(id,organization_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, patient_id uuid not null,
  sender_type text not null check (sender_type in ('CARETAKER','PATIENT')),
  sender_id uuid not null references auth.users(id),
  message_type text not null check (message_type in ('PRESET','CUSTOM','PATIENT_REQUEST')),
  message text not null check (length(message) between 1 and 2000),
  request_code text check (request_code in ('HELP','HUNGRY','NOT_RIGHT')),
  created_at timestamptz not null default now(), delivered_at timestamptz, acknowledged_at timestamptz,
  foreign key(patient_id,organization_id) references public.patients(id,organization_id),
  unique(id,organization_id)
);
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, patient_id uuid,
  event_id uuid, device_id uuid,
  alert_type text not null check (alert_type in ('MEDICINE_NOT_TAKEN','MEAL_NOT_COMPLETED','CONCERNING_CHECK_IN','PATIENT_HELP_REQUEST','PATIENT_SOMETHING_WRONG','MISSED_EVENT','DEVICE_OFFLINE')),
  message text not null,
  priority text not null check (priority in ('NORMAL','ATTENTION','HIGH')),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  reviewed boolean not null default false, reviewed_by uuid, reviewed_at timestamptz,
  foreign key(patient_id,organization_id) references public.patients(id,organization_id),
  foreign key(event_id,organization_id) references public.care_events(id,organization_id),
  foreign key(device_id,organization_id) references public.devices(id,organization_id),
  foreign key(reviewed_by,organization_id) references public.profiles(id,organization_id),
  check ((not reviewed and reviewed_by is null and reviewed_at is null)
    or (reviewed and reviewed_by is not null and reviewed_at is not null))
);
create table public.game_sessions (
  id uuid primary key,
  organization_id uuid not null, patient_id uuid not null, event_id uuid not null unique,
  game_id uuid not null, device_id uuid not null,
  started_at timestamptz not null, completed_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  score numeric, result_data jsonb not null default '{}',
  foreign key(event_id,patient_id,organization_id) references public.care_events(id,patient_id,organization_id),
  foreign key(game_id,organization_id) references public.games(id,organization_id),
  foreign key(device_id,organization_id) references public.devices(id,organization_id),
  check (completed_at >= started_at)
);
create table public.interaction_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  patient_id uuid, device_id uuid, event_id uuid,
  action text not null, data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key(patient_id,organization_id) references public.patients(id,organization_id),
  foreign key(device_id,organization_id) references public.devices(id,organization_id),
  foreign key(event_id,organization_id) references public.care_events(id,organization_id)
);

-- Configuration tables retain simple dated schedules; generated events are authoritative.
do $ddl$
declare t text; extra text;
begin
  foreach t in array array['check_in_questions','medicines','meals','tasks','game_assignments'] loop
    extra := case t
      when 'check_in_questions' then 'question text not null, answers jsonb not null check (jsonb_typeof(answers) = ''array'' and jsonb_array_length(answers) > 0), concerning_answers jsonb not null default ''[]'' check (jsonb_typeof(concerning_answers) = ''array'' and answers @> concerning_answers),'
      when 'medicines' then 'name text not null, dosage text not null, instructions text,'
      when 'meals' then 'meal_type text not null check (meal_type in (''BREAKFAST'',''LUNCH'',''DINNER'',''SNACK'')), description text,'
      when 'tasks' then 'title text not null, description text,'
      when 'game_assignments' then 'game_id uuid not null, duration_minutes integer not null default 10 check (duration_minutes between 1 and 120), foreign key(game_id,organization_id) references public.games(id,organization_id),'
    end;
    execute format('create table public.%I (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null, patient_id uuid not null,
      %s
      scheduled_time time not null,
      recurrence text not null default ''DAILY'' check (recurrence in (''ONCE'',''DAILY'',''WEEKLY'')),
      start_date date not null default current_date, end_date date,
      enabled boolean not null default true,
      created_by uuid not null default auth.uid(),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      foreign key(patient_id,organization_id) references public.patients(id,organization_id),
      foreign key(created_by,organization_id) references public.profiles(id,organization_id),
      check (end_date is null or end_date >= start_date)
    )', t, extra);
  end loop;
end $ddl$;

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create function private.validate_event() returns trigger language plpgsql set search_path = '' as $$
begin
  new.scheduled_at := (new.scheduled_date + new.scheduled_time) at time zone new.timezone;
  if new.due_at is null or (TG_OP = 'UPDATE' and new.scheduled_at <> old.scheduled_at and new.due_at = old.due_at) then
    new.due_at := new.scheduled_at + interval '1 hour';
  end if;
  if new.event_type = 'TASK' then new.response_required := false; end if;
  if new.event_type = 'DAILY_CHECK_IN' and
    (jsonb_typeof(new.payload->'answers') is distinct from 'array'
     or jsonb_array_length(new.payload->'answers') = 0
     or not ((new.payload->'answers') @> coalesce(new.payload->'concerning_answers','[]'::jsonb))) then
    raise exception 'Check-in requires answer choices and valid concerning answers';
  end if;
  if new.event_type = 'REHABILITATION_GAME' and not exists (
    select 1 from public.games g where g.id = (new.payload->>'game_id')::uuid and g.organization_id = new.organization_id and g.active
  ) then raise exception 'An active game in this organization is required'; end if;
  return new;
end $$;
create trigger validate_event before insert or update on public.care_events for each row execute function private.validate_event();

create function private.is_staff(org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and organization_id = org)
$$;
create function private.is_admin(org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and organization_id = org and role = 'admin')
$$;
create function private.device_patient(pid uuid, org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.devices d join public.patients p on p.id = d.assigned_patient_id
    where d.auth_user_id = (select auth.uid()) and d.organization_id = org and d.assigned_patient_id = pid
    and d.revoked_at is null and p.status = 'ACTIVE')
$$;

-- Revoke inherited Supabase defaults before granting the operations actually supported.
do $security$
declare t text;
begin
  foreach t in array array['organizations','profiles','patients','games','devices','pairing_codes','care_events','patient_responses','messages','alerts','game_sessions','interaction_logs','check_in_questions','medicines','meals','tasks','game_assignments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy staff_read on public.%I for select to authenticated using (private.is_staff(%I))',t,case when t = 'organizations' then 'id' else 'organization_id' end);
    if t <> 'organizations' then execute format('create index on public.%I(organization_id)',t); end if;
    if t in ('patients','care_events','devices','check_in_questions','medicines','meals','tasks','game_assignments') then
      execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
    end if;
    if t in ('patients','care_events','games','check_in_questions','medicines','meals','tasks','game_assignments') then
      execute format('grant insert, update on public.%I to authenticated',t);
      execute format('create policy staff_insert on public.%I for insert to authenticated with check (private.is_staff(organization_id))',t);
      execute format('create policy staff_update on public.%I for update to authenticated using (private.is_staff(organization_id)) with check (private.is_staff(organization_id))',t);
    end if;
  end loop;
end $security$;
-- Configuration is disabled, and events are skipped, rather than deleting patient history.
create policy device_read_events on public.care_events for select to authenticated
  using (private.device_patient(patient_id,organization_id));
create policy device_read_messages on public.messages for select to authenticated
  using (private.device_patient(patient_id,organization_id));
create policy device_read_self on public.devices for select to authenticated
  using (auth_user_id = (select auth.uid()) and revoked_at is null);
-- Even admins cannot repoint a registered device's auth identity with a REST update.
grant update(device_name, assigned_patient_id, revoked_at) on public.devices to authenticated;
create policy admin_update_devices on public.devices for update to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create index events_patient_schedule on public.care_events(patient_id,scheduled_at);
create index events_pending on public.care_events(due_at) where status in ('SCHEDULED','PENDING');
create index messages_patient_time on public.messages(patient_id,created_at);
create index alerts_unreviewed on public.alerts(organization_id,created_at desc) where not reviewed;
create index history_patient_time on public.interaction_logs(patient_id,created_at desc);
create index responses_patient_time on public.patient_responses(patient_id,response_time desc);

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_staff(uuid), private.is_admin(uuid), private.device_patient(uuid,uuid) to authenticated;
commit;
