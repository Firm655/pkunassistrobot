# Deployment record — 2026-09-23

Target: `pkun-assistant`, project reference `odmkxzclcihkfztamiul`, P-kun Supabase organization, free plan, Seoul (`ap-northeast-2`). The project owner completed database password entry and project creation.

Applied through Supabase SQL Editor:

| Version | Change |
| --- | --- |
| 202609230001 | Schema, constraints, indexes, RLS and grants |
| 202609230002 | Pairing, device RPCs, responses, requests, messaging and review |
| 202609230003 | Schedule generation and maintenance |
| 202609230004 | Realtime publication |
| 202609230005 | One-minute pg_cron job |
| 202609230006 | Null patient-assignment guard for acknowledgements |
| 202609230007 | Private patient-photo bucket and Storage policies |

Verified on the hosted database:

- Application tables: **17**, all **17** with RLS enabled.
- Realtime publication: **7** application tables.
- `pkun-maintenance`: active; latest observed cron run **succeeded**.
- `patient-photos`: private.
- Hosted SQL smoke test: **PASS**, exercising tenant isolation, pairing, device-note isolation, caregiver event → device response → alert, retry deduplication, help requests, and message acknowledgement.
- Synthetic fixtures rolled back; **0** Auth users remained after the test.

Local verification: **19 passing tests**, using PostgreSQL via PGlite. No real patient information, credentials or clinical advice was seeded.

Not yet verified: real user sign-in/session refresh, Storage HTTP uploads, WebSocket delivery to clients, Raspberry Pi offline synchronization, Kivy/ROS behavior or a browser dashboard. These require the application clients and real caregiver/device Auth accounts. A published Realtime table is not proof that a client subscription has been tested.

First-use setup remains: create the first confirmed caregiver Auth account, run the guarded bootstrap template with its UUID, create a dedicated device Auth account, pair and assign the device, then connect the React and Pi applications. The Supabase console identity is not an application caregiver identity.
