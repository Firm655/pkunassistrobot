# P-kun Care — Caregiver Dashboard (React)

React + TypeScript web dashboard for the P-kun elder-care platform. It talks **only to Supabase**
(the backend in [`Firm655/pkunassistrobot`](https://github.com/Firm655/pkunassistrobot)); it never
talks to the Raspberry Pi directly.

```
Caregiver (this app) ──► Supabase (Postgres + RLS + RPCs + Realtime) ◄── P-kun (Kivy on Raspberry Pi)
```

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in the publishable key (already filled in if you received .env.local)
npm run dev                      # http://localhost:5173
npm run build                    # type-check + production build into dist/
```

`.env.local`

```
VITE_SUPABASE_URL=https://odmkxzclcihkfztamiul.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the browser-safe **publishable** key goes here. Never put the service-role key in this app.

## Free GitHub Pages deployment

The public repository deploys the dashboard automatically with GitHub Actions after changes to
`dashboard/` land on `main`. Add these repository secrets once under **Settings → Secrets and
variables → Actions**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

After the first successful workflow, the dashboard is available at
`https://firm655.github.io/pkunassistrobot/`. Anyone with repository write access can edit the
dashboard and push a change; GitHub rebuilds and publishes it automatically. The service-role key
must never be added as a secret or bundled into the browser app.

## First login (one-time backend setup)

The database starts empty, and a Supabase Auth user is **not** a caregiver until a profile is provisioned.

1. Supabase Dashboard → Authentication → Users → **Add user** (email + password, auto-confirm).
2. Copy that user's UUID, paste it into `supabase/seed/bootstrap.sql` (backend repo) and run it in the
   SQL editor. This creates the organization and makes the user an **admin**.
3. Sign in to the dashboard. More caregivers: create their Auth user, then *Team & settings → Add caregiver*.
   (Anyone who signs in without a profile sees an "Access not provisioned" screen showing their user ID.)
4. *P-kun devices → Generate pairing code* (admin), enter it on the Pi (signed in with its **own** Auth
   account), then assign the device to a patient on the same page.

## Features (mapped to the spec)

| Area | What's there |
| --- | --- |
| Auth | Email/password login, protected routes, session persistence/refresh, logout, not-provisioned screen, caregiver profile |
| Dashboard | Today's date, upcoming / recently completed / missed events, active alerts, patient overview, device status, latest patient requests, quick actions |
| Patients | List (photo, status, today's summary, open alerts, assigned P-kun), create/edit, private photo upload, 🔒 caretaker-only care notes |
| Patient profile | Overview, patient calendar, care activities, responses (medicine adherence, meal responses, recent responses), check-in responses, history |
| Calendar | FullCalendar month / week / day / list; all-patients or single patient; filter by patient, type, status; click day to create, click event to view/edit/skip |
| Care activities | Daily check-ins (answers + concerning answers), medicines, meals (+ default 08/12/18), tasks — one-off or DAILY/WEEKLY, enable/disable |
| Daily check-in | Date-based patient questions and answers, status summary, patient requests, and caregiver-selected button-answer follow-ups (requires backend migration `202609240002`) |
| Alerts | Open / all, filter by patient, priority, type; open patient/event, mark reviewed (single or bulk) |
| History | Filters: patient, date range, event type, status. Tabs: care events & responses, check-ins & requests, alerts, activity log |
| Devices | Status (with stale-heartbeat detection), last seen, app version, capabilities, pairing codes with countdown, assign/unassign, rename, revoke |
| Realtime | One org-scoped channel; new alerts and patient requests pop up as toasts; affected lists refresh without reload |

## How it uses the backend

- **One-off vs recurring.** "Does not repeat" inserts a single dated `care_events` row. Daily/weekly
  inserts a configuration row (`medicines`, `meals`, `check_in_questions`, `tasks`)
  and calls `refresh_schedules`; the backend expands it into dated events (and keeps doing so via cron).
- **Editing.** One-off events are updated in place. For a single occurrence of a recurring series, the
  generated row is marked `SKIPPED` and a one-off replacement is created — the skipped row keeps its
  unique `(source, date)` key so the scheduler won't regenerate it. "Edit series" edits the config row.
- **No deletes.** Following the backend's design, events are *skipped* and schedules *disabled*; history stays.
- **Care notes never leave the caregiver side.** They live only on `patients` (devices have no read access
  to that table). Event `title`/`description`/`payload` are patient-facing, and the form says so.
- **Realtime is an invalidation signal only.** Every change on a published table bumps a version counter
  and the pages that depend on that table refetch (`src/hooks/useData.ts`, `src/contexts/RealtimeContext.tsx`).
  RLS is the security boundary.
- **Times.** `scheduled_date` + `scheduled_time` are the organization's local wall-clock time
  (default Asia/Bangkok) and are shown as-is; absolute timestamps are formatted in the org timezone.
- RPCs used: `refresh_schedules`, `review_alert`, `create_pairing_code`, `provision_caregiver`.

## Project structure

```
src/
  App.tsx                 routes
  main.tsx
  types/db.ts             row types mirroring the SQL schema
  lib/                    supabase client, constants (labels, colors, presets)
  contexts/               Auth, Realtime, ReferenceData (patients/devices/profiles), Toast
  hooks/useData.ts        tiny fetch hook with realtime-driven refetch
  layouts/AppLayout.tsx   sidebar shell
  components/ui.tsx       Badge, Card, Modal, Field, Tabs, Avatar, ...
  features/
    care-events/          activity model + API, create/edit form, details modal, activities panel
    calendar/             CareCalendar (FullCalendar)
    patients/ alerts/ messages/ devices/ history/
  pages/                  one file per route
  styles/global.css
```

## Verification done

- `tsc` strict type-check and production build pass.
- Every write the dashboard performs (patients, all four event types, recurring configs + refresh,
  occurrence edit/skip, schedule disable, messages, pairing, device assign/rename/revoke,
  alert review) was executed on the hosted database as a signed-in caregiver, together with a
  simulated P-kun (pair → heartbeat → "NO" medicine response → help request → acknowledgement). All
  passed, and the device could not read the `patients` table. The test ran inside a rolled-back
  transaction, so no data was left behind.
- All pages were rendered in headless Chromium with mocked Supabase responses (desktop + phone width)
  with no runtime errors.
- **Not yet verified:** a real browser session against the hosted project (sign-in, WebSocket
  Realtime delivery, Storage upload). Run through the demo script below once you have a caregiver account.

## Demo script

1. Log in → *Patients → Add patient*.
2. Patient → *Calendar* → click today → Medicine at the next minute → Save.
3. On P-kun (or via the `submit_response` RPC) answer **NO** → the event turns red (Alert),
   a toast appears, and *Alerts* shows it → *Mark reviewed*.
4. *Daily check-in* → select a patient, review the question and answer, and send a button-answer follow-up.
5. P-kun "I need help" → urgent toast + HIGH alert in real time, with the request available under *Check-ins*.
