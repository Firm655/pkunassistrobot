-- Already applied manually through the SQL editor on 2026-09-23; recorded here so the repo matches the database.
-- 008 dropped public.games but validate_event() still referenced it, breaking every care_events write.
create or replace function private.validate_event() returns trigger
language plpgsql set search_path = '' as $$
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
  return new;
end $$;
