# Client contract

All RPC examples use `supabase.rpc(name, parameters)` and require checking the returned `error`. REST table operations and Realtime both enforce RLS. A publishable key alone grants no application-table access.

## Caregiver

After `auth.signInWithPassword`, load `profiles` for the current user. If no profile exists, show “Access not provisioned”; do not assume every Auth user is a caregiver. Use `auth.onAuthStateChange` and clear state on logout.

Read and insert/update `patients`, `care_events`, `check_in_questions`, `medicines`, `meals`, `tasks`, `games` and `game_assignments`. Supply your profile's `organization_id`. Database constraints prevent foreign-organization patient, caregiver, game and device links. Devices cannot perform these writes.

For a dated medicine event:

```ts
await supabase.from('care_events').insert({
  organization_id: profile.organization_id,
  patient_id: patient.id,
  event_type: 'MEDICINE', title: 'Medicine reminder',
  scheduled_date: '2026-09-24', scheduled_time: '08:00',
  timezone: 'Asia/Bangkok',
  payload: { name: 'Caregiver-entered name', dosage: 'Caregiver-entered dosage', instructions: '' }
});
```

`created_by` defaults to the signed-in user. `scheduled_at` and `due_at` are calculated server-side; provide `due_at` only to override the one-hour window. `description` and `payload` are patient-facing. Never put private care notes in either field. Store notes only on `patients`.

Check-in payload: `{answers: ['Fine', 'Unwell'], concerning_answers: ['Unwell']}`. Game payload: `{game_id: 'UUID', duration_minutes: 10}`. Games are organization-specific. For recurring activities insert the corresponding configuration row, including `start_date`, optional `end_date`, `scheduled_time` and `recurrence: 'ONCE' | 'DAILY' | 'WEEKLY'`, then call `refresh_schedules`.

| RPC | Parameters | Returns |
| --- | --- | --- |
| `refresh_schedules` | `horizon_days` (default 7, max 31) | Count of dates processed (not newly inserted rows) |
| `send_caregiver_message` | `submission_id`, `patient_id`, `message`, `message_type` (`CUSTOM` or `PRESET`) | Message UUID |
| `review_alert` | `alert_id` | void |
| `create_pairing_code` | none; administrator only | `{code, expires_at}` |
| `provision_caregiver` | `user_id`, `organization_id`, `full_name`, `role` | void; administrator only |

Reuse the same submission UUID and contents on a message retry. Admins can update only `device_name`, `assigned_patient_id` and `revoked_at` directly on devices. A device Auth identity cannot be changed by a table update.

Photo upload path: `ORGANIZATION_UUID/PATIENT_UUID/RANDOM_UUID.jpg` in private bucket `patient-photos`. Store the object path in `patients.profile_photo`. Request short-lived signed URLs only while authenticated as a caregiver; do not store signed URLs permanently or distribute them to devices.

## P-kun

Use a dedicated Supabase Auth account, a publishable key, and normal session refresh. Pairing does not grant staff permissions and the code is not a permanent password. Pairing codes contain a random UUID (122 random bits), are stored only as SHA-256 hashes, expire after ten minutes and are consumed transactionally.

| RPC | Parameters | Returns |
| --- | --- | --- |
| `pair_device` | `pairing_code`, `device_name` | Device UUID |
| `device_context` | none | `{device_id, patient_id, patient_name, timezone}` or a null patient assignment |
| `device_heartbeat` | `app_version`, `capabilities` object | Server last-seen timestamp |
| `submit_response` | `submission_id`, `patient_id`, `event_id`, `response`, `response_data`, `response_time` | Response UUID |
| `send_patient_request` | `submission_id`, `patient_id`, `request_code` (`HELP`, `HUNGRY`, `NOT_RIGHT`) | Message UUID |
| `acknowledge_message` | `message_id`, `patient_id`, `acknowledged` (default true) | void |

`submit_response` accepts MEDICINE/MEAL `YES` or `NO`, a configured DAILY_CHECK_IN answer, TASK `DISPLAYED`, and REHABILITATION_GAME `COMPLETED`. Game `response_data` must include ISO timestamps `started_at`, `completed_at`, optional numeric `score`, and optional result details. The database computes duration and uses the event's game ID. No client-supplied patient, device or game relationship is trusted.

Generate `submission_id` once and persist the entire request to SQLite **before** sending it. Keep the original `response_time` on every retry; defaults are convenient for a one-off call but not offline replay. Network errors and timeouts are retryable; assignment/revocation/validation errors must be quarantined for operator review. Never silently change the patient ID of a queued response. Closed events reject a second, different submission ID.

At startup/reconnect:

1. Refresh Auth and call `device_context`. Clear cached events/messages if the patient changed or assignment is null. A revoked or unauthorized session must stop normal synchronization.
2. Query `care_events` for the assigned patient and a bounded schedule window; paginate when necessary. Cache results in SQLite, keyed by event UUID. Reconcile statuses including SKIPPED and completed rows.
3. Read undelivered/unacknowledged caregiver messages. Mark delivery with `acknowledge_message(..., acknowledged: false)` and acknowledgement only after patient action.
4. Replay the persistent outbox with unchanged submission IDs and timestamps. Keep failed entries for diagnosis.
5. Reconcile again after reconnecting and on a periodic timer. Realtime notifications can be missed; they are an invalidation signal, not the scheduler or the durable queue.

The Pi's clock/timer presents cached events at `scheduled_at`. The database deadline logic works independently of the Pi. A real device must implement the SQLite cache/outbox, Kivy presentation and ROS hooks; this backend does not pretend those clients already exist.

## Realtime

Published tables: `care_events`, `messages`, `patient_responses`, `alerts`, `devices`, `game_sessions`, `interaction_logs`.

```ts
const channel = supabase.channel('patient-events')
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'care_events',
    filter: `patient_id=eq.${patientId}`
  }, () => refetchEvents())
  .subscribe();
// Clean up on logout, unmount or assignment change:
await supabase.removeChannel(channel);
```

Caregiver subscriptions should filter by `organization_id`; Pi subscriptions filter by `patient_id`. Filters reduce traffic; RLS is the security boundary. Rebuild subscriptions after assignment changes. Never subscribe using a service-role key.

## Service-only maintenance

`run_maintenance()` is executable only by the database owner/cron or service role. It runs every minute through `pkun-maintenance`. Signed-in caregivers and devices cannot invoke it. Inspect `cron.job_run_details` for failures. The prototype deliberately uses database functions instead of unnecessary Edge Functions.
