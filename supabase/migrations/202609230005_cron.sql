-- Supabase hosts support pg_cron. Apply after the core migrations.
create extension if not exists pg_cron;
select cron.schedule('pkun-maintenance', '* * * * *', 'select public.run_maintenance();');
