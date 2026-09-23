begin;
-- DELETE is intentionally not a client operation: SKIPPED/INACTIVE updates preserve RLS-filtered history.
do $publication$
declare t text;
begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['care_events','messages','patient_responses','alerts','devices','interaction_logs'] loop
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $publication$;
commit;
