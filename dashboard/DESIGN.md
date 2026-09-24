# P-kun Care workspace

The daily screen is a care agenda with patient selection and a persistent follow-up area. Shared navigation, typography, controls, tables, and forms use the same clinic workspace styling.

## References inspected

- [Jane: Working with the schedule](https://jane.app/guide/working-with-the-schedule): day-based navigation, a selectable people list, and a working schedule with context kept nearby.
- [Linear: My issues](https://linear.app/docs/my-issues): focused work views, status filters, and clear separation between navigation and work items.

These references informed the structure. Their logos, screenshots, and other assets are not included in P-kun.

## Behavior

- Select a patient to filter the agenda, open alerts, requests, and devices.
- The agenda is for the selected date; open alerts remain visible across dates and are labeled accordingly.
- Date arrows, Today, and the date input load the corresponding care events.
- Scheduling starts with the selected patient and date prefilled.
- Reviewing an alert refreshes the follow-up queue even when realtime is reconnecting.
- Data errors remain visible; the schedule provides a retry action.
- The shared visual system lives in `src/styles/workspace.css`; existing care workflows remain backed by the same APIs.

## Verification

Run the local Vite server on port 5187, then run `npm run test:ui`. Tests use intercepted local backend fixtures, not real patient records. The script defaults to installed Microsoft Edge; set `BROWSER_CHANNEL` to another installed Playwright-supported browser channel if required. `UI_TEST_URL` overrides the server URL. The fixture session assumes the unconfigured localhost Supabase fallback.

The test covers 1440, 768, 390, and 320 pixel layouts, search, patient selection, date navigation, status filters, scheduling defaults, event details, alert review, directory navigation, sparse data, and error recovery. Screenshots are saved under the operating system temporary directory in `pkun-ui-check`.
