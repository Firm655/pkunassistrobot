# P-kun Assistant backend

Supabase backend for the caregiver → P-kun → patient → caregiver loop. The original requirements are in `docs/specification.json`.

## Implemented

- 17 application tables with RLS and organization-scoped foreign keys.
- Supabase Auth identities separated into explicitly provisioned caregivers and paired device accounts.
- Caregiver-only patient records, including every care note. Devices receive only the allowlisted `device_context()` result plus their assigned patient's events/messages.
- Single-use, hashed pairing codes with a ten-minute lifetime; device revocation and assignment checks.
- Atomic response processing, game sessions, alerts, requests, messages, acknowledgements and history.
- Stable request IDs for safe offline retries; stale assignments are rejected instead of attaching data to a new patient.
- Dated events and bounded ONCE/DAILY/WEEKLY schedule expansion; backend missed-event and offline-device detection.
- RLS-filtered Realtime publication and a one-minute cron job.
- Private caregiver-only patient photo bucket (JPEG/PNG/WebP, 5 MB).

This repository currently implements the **database and backend**. The React dashboard, calendar UI, Kivy screens, rehabilitation games and ROS integration remain application work. No clinical decision logic is implemented.

## Project

Supabase project: `odmkxzclcihkfztamiul` (`pkun-assistant`), organization `P-kun`, free plan.

Project URL: https://odmkxzclcihkfztamiul.supabase.co

The Supabase dashboard organization is separate from the application's `public.organizations` rows. A dashboard login does not automatically create a caregiver Auth account or profile.

## Test

```sh
npm ci
npm test
```

Tests execute the core SQL in PGlite (PostgreSQL compiled to WebAssembly), with `auth.uid()`/`auth.role()` fixtures. They test real SQL constraints, RLS and transactions; they do not simulate Auth email delivery, WebSocket transport, Storage API uploads or the cron daemon. Hosted smoke checks are in `supabase/tests/hosted_smoke.sql`.

## Deploy

Use the Supabase CLI with your own authenticated CLI session:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Apply migrations in filename order. `005` requires `pg_cron`; `007` requires the Supabase Storage schema. For deployment through the dashboard SQL editor, run each file once and record the applied versions. Do not rerun table-creation migrations on an already initialized project. The deployment record in `docs/deployment.md` states what has actually been verified.

Keep service-role keys and database passwords out of the dashboard and Pi. Use only the public/publishable key plus a normal Auth session in clients. See `.env.example`.

## First caregiver and device

1. Create a real project Auth account for the first caregiver through Supabase Auth. Complete any password or email verification yourself.
2. As the project owner in SQL Editor, insert an application organization and a profile referencing that confirmed Auth user. `supabase/seed/bootstrap.sql` is a deliberately guarded template; fill in the user UUID first. Ordinary signups have no staff access.
3. Administrators can call `provision_caregiver` for additional existing Auth users in their own organization. Device identities cannot be promoted to caregivers.
4. Provision a separate confirmed Auth account for each Pi; do not give it a profile. The operator signs it in using Supabase Auth and calls `pair_device` with a code returned by an administrator's `create_pairing_code` call.
5. An administrator sets `devices.assigned_patient_id`. Device JWTs never authorize another patient's data; `revoked_at` immediately blocks subsequent database access.

See `docs/api.md` for RPC payloads and client integration details.

## Prototype scheduling decisions

Dates and times are interpreted in an explicit IANA timezone (default `Asia/Bangkok`). `scheduled_at` is calculated by a trigger; the default deadline is one hour after the event. The organization's timezone drives generated schedules.

Maintenance expands today plus seven future days, then sets due events to PENDING, marks overdue events MISSED, and checks heartbeats. Caregiver apps should also call `refresh_schedules` after changing configuration for immediate propagation. WEEKLY repeats on the start date's weekday. A skipped occurrence stays skipped; re-enabling a configuration does not resurrect canceled occurrences. Edit an individual dated event for a one-off exception.

Tasks use a `DISPLAYED` device receipt after the 15-second reminder; they do not ask the patient to confirm. Events without a receipt can become MISSED even if no patient response was required. A late queued response can complete a MISSED event; the missed alert remains in history for review.

Heartbeat clients send at most once per minute. Server writes are throttled to 30 seconds; three minutes without a heartbeat generates one alert per outage. An assigned device that never sends its first heartbeat can also become offline.

Configuration tables are disabled instead of deleted; events are skipped instead of deleted. Completed responses and history remain available. The server cannot erase data already cached on an offline device: the Pi must refresh assignment on reconnect and clear its prior patient's cache before showing another patient's information.
