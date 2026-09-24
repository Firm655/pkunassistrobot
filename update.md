# Daily check-in UX/UI update plan

Date: 2026-09-24  
Status: Implemented locally on 2026-09-24; hosted migration and live device validation remain.

## Implementation notes

- The dashboard now shows date-based daily check-in questions, patient answers, status counts, patient requests, and linked follow-ups. The patient profile links to this view.
- Caregivers can choose a follow-up template or supply a question with 2–5 answer buttons. The server validates the options, links the follow-up to its source answer, and handles duplicate send retries.
- The P-kun client displays follow-ups through the existing check-in path, requires answer selection and confirmation, and keeps caregiver contact accessible.
- The SQL migration `supabase/migrations/202609240002_check_in_followups.sql` must be applied before using the new dashboard page. It has passed local PGlite tests but has not been applied to the hosted database.
- Delivery/display receipts and a persisted review status for ordinary answers are not implemented. The UI does not claim that a queued question was displayed or that a concern was resolved.
- Automatic branching and a care-team review of template wording remain deferred. Test the final layout on the physical P-kun screen and with real browser sessions before production use.

## 1. Goal

Turn the current message-style Check-ins page into a daily review workspace. Caregivers should see the question, the patient's answer, and the next relevant action together. They can send a related follow-up with predefined answer buttons. Patients never need to type.

Keep the existing React, Supabase, and P-kun architecture. Use the existing teal identity and shared components as the foundation.

## 2. Current findings

Findings are based on source inspection, not a live visual audit.

- `dashboard/src/pages/CheckInsPage.tsx` lists patient messages with no daily date filter or check-in progress.
- `dashboard/src/features/messages/MessageThread.tsx` renders incoming bubbles without the original check-in question or a follow-up action.
- The page queries `messages`, while `submit_response` stores actual check-in answers in `patient_responses` and `care_events`. Correcting this data source is the first priority.
- Existing check-in forms already support predefined answers and configured concerning answers. Reuse that capability.
- Check-ins currently sits in secondary navigation. Move Daily check-in into the main navigation because it is a daily caregiver task.
- The stylesheet already defines teal actions, white surfaces, a dark teal sidebar, and semantic status colors. Improve consistency and readability rather than introducing a separate visual identity.

## 3. Page layout and information hierarchy

### Header

- Title: **Daily check-in**.
- Supporting text: “Review patient answers and send guided follow-up questions.”
- Date selector, previous/next day controls, and Today shortcut. Use the organization's timezone.
- Summary: scheduled questions, answered, awaiting response, and overdue. Needs review is a separate count because it overlaps with answered questions.
- Separate initial daily questions from follow-ups in progress totals, for example “3 of 4 daily questions answered · 1 follow-up pending.”

### Patient list

- Desktop: approximately 300–340 px wide; remaining space belongs to patient details.
- Search by name and filter by All, Needs review, Awaiting response, or Overdue.
- Each row shows photo/initials, name, daily progress, last response time, and a labelled attention indicator.
- Prioritize patients needing review, then overdue patients. Preserve the selected patient and scroll position during live updates.
- Patients with no scheduled check-in show “Nothing scheduled,” not “No response.”
- Avoid calculating global progress from a capped recent-message list; query or aggregate the selected day's relevant events.

### Patient details

- Header: patient identity, selected date, device status, and Open patient profile.
- Show each daily question as a card, with the patient's answer as its most prominent content.
- Include scheduled time, actual response time, response status, and any review indicator.
- Primary card action after an answer: **Ask follow-up**.
- Group follow-ups directly underneath the original question in chronological order. Show their dates when they cross midnight.
- Keep help requests in a distinct, visible section with a link to the existing alert workflow.
- Reviewed means reviewed by a caregiver; it must not imply the patient's concern has been resolved.

### Responsive behavior

- Wide screens: patient list and details side by side.
- Narrow screens: patient list first, then full-width patient details with Back to patients; retain date and filters.
- Follow-up editor uses a side panel on wide screens and a full-screen dialog on phones.
- No horizontal scrolling for ordinary questions or answer labels; long text wraps.

## 4. Visual style and colors

Direction: calm, clear, warm, and practical. Use generous spacing, quiet surfaces, readable text, and small purposeful status accents.

### Proposed color tokens

| Role | Color | Usage |
| --- | --- | --- |
| Page background | `#F4F6F8` | Main workspace |
| Surface | `#FFFFFF` | Cards, panels, inputs |
| Subtle surface | `#F8FAFB` | Grouped follow-ups and secondary areas |
| Main text | `#17212B` | Headings, questions, patient answers |
| Secondary text | `#51606F` | Timestamps and explanatory text |
| Decorative border | `#E2E8EE` | Card dividers; not the only boundary of an interactive control |
| Control border | `#7A8997` | Inputs and outlined answer buttons; verify against adjacent surfaces |
| Primary teal | `#0F766E` | Main actions, links, selected controls |
| Primary hover | `#0D655E` | Hover/pressed emphasis |
| Teal tint | `#E7F5F3` | Selected patient and selected answer background |
| Sidebar | `#0F2A2E` | Existing dark navigation; white active text |
| Informational | `#1D4ED8` / `#E8EFFD` | Informational text / background |
| Success | `#15803D` / `#E6F4EA` | Answer received or completed / background |
| Attention | `#B45309` / `#FDF1E1` | Needs review or overdue / background |
| Urgent/error | `#B91C1C` / `#FDEAEA` | Existing urgent requests and errors / background |
| Neutral | `#51606F` / `#EEF1F4` | Scheduled, skipped, or unavailable / background |

Rules:

- Use white text on solid primary buttons. Use dark semantic text on pale status backgrounds.
- Every status includes words and optionally an icon; color alone never carries meaning.
- Keep routine cards white. Use a small badge or accent for attention instead of filling the entire page with red or green.
- Patient answer buttons use neutral styling before selection and teal after selection. Do not visually suggest that one answer is preferred.
- Answer received is a workflow status, not a statement that the patient is well. A concerning answer can be received and still need review.
- Check final rendered contrast: at least 4.5:1 for normal text, 3:1 for large text and required control/focus indicators. These are implementation acceptance targets, not a claim that the current UI has been verified.

### Typography, spacing, and components

- Dashboard body: 16 px, approximately 1.5 line height. Metadata: 14 px minimum for this page.
- Page heading: 28–32 px; section headings: 20 px; question: 18 px; selected answer: 20–24 px, semibold.
- Retain the system/Inter font stack and Thai support; verify actual Thai font availability and wrapping.
- Spacing scale: 4, 8, 12, 16, 24, 32 px. Use 24 px card padding on desktop and 16 px on phones.
- Cards: 12 px radius, thin border, subtle shadow. Avoid excessive nested boxes.
- Caregiver controls: minimum 44 px touch target. Use a clear focus ring with visible offset.
- Replace mixed decorative emoji in the affected navigation and controls with a consistent icon style and text labels.
- Buttons use concrete verbs: Ask follow-up, Send question, Cancel, View alert, Mark reviewed.
- Use one strong primary action per panel. Secondary actions use outlined or text buttons.
- Respect reduced-motion settings. New responses should not force scrolling or interrupt the caregiver's reading.

## 5. Structured follow-up workflow

1. Caregiver selects **Ask follow-up** on a specific response.
2. Panel repeats the patient name, original question, and selected answer.
3. Show relevant predefined templates based on the question topic and answer.
4. Caregiver selects a template, checks the wording and answer choices, and previews the patient screen.
5. Caregiver selects **Send question**. Keep the question visible with its delivery/response state.
6. Patient taps a predefined answer on P-kun. The answer appears under the original question without a manual refresh.

Start with caregiver-selected templates. Automatic branching is a later phase and must use explicit configured rules, not inferred diagnoses.

| Original answer/context | Follow-up question | Predefined answer buttons |
| --- | --- | --- |
| Did not sleep well | What disturbed your sleep? | Could not fall asleep / Woke up often / Woke up early / Not sure |
| Has not eaten | Why haven't you eaten? | Not hungry / Food not ready / Need help / Something else |
| Feeling lonely | Would you like someone to contact you? | Yes, please / Later / No, thank you |
| Asked for help | What would you like help with? | Moving around / Food or drink / Contact caregiver / Something else |

These are draft interaction examples, not clinical assessment rules. Help requests remain visible immediately; answering a follow-up is never required before a caregiver can act.

Template rules:

- Default to 2–4 short, distinct options; permit up to 5 when necessary and verify on the actual screen.
- Include Not sure, Answer later, or a caregiver-contact choice where appropriate.
- Something else leads to another defined choice or caregiver contact, never a typing field.
- Caregivers may author a custom question only when they also provide valid predefined choices. Start with the template picker as the default.
- Reject empty/duplicate options. Keep labels concise but allow wrapping.
- Show a pending follow-up before allowing another for the same response. Make duplicate sends safe during retries.
- Preserve the exact wording and choices sent; editing a template must not rewrite history.
- Follow-up completion must not automatically mark an alert reviewed or resolved.

## 6. Patient screen on P-kun

- One question at a time with a short progress label where applicable.
- Question text: approximately 28–32 px; answer text: 22–24 px as a starting point, validated on the physical screen.
- Large answer targets, initially at least 64 px high with 12–16 px separation. Increase sizing based on actual screen and patient testing.
- Prefer vertically stacked options; use a simple grid only when labels remain easy to read and tap.
- No keyboard, free-text response field, or interaction that depends on precise gestures.
- Clearly indicate the selected answer and provide a simple confirm/change step before submission.
- Keep Contact caregiver available throughout.
- Show Sent only after server confirmation. Offline wording: “Answer saved. Waiting for connection.”
- Answer later is a deferral, not a completed check-in; define the reminder policy before implementation.
- Avoid automatic dismissal before the patient can read confirmation.

## 7. States and accessibility

Distinguish response progress, delivery, and caregiver review; do not combine them into one ambiguous badge.

| Situation | Display/behavior |
| --- | --- |
| Before scheduled time | Scheduled, with time |
| Due, no response | Awaiting response |
| Deadline passed | Overdue; no answer received |
| Response received | Selected answer and actual response time |
| Configured concerning answer | Needs review badge and related alert |
| Follow-up saved on server | Queued for P-kun until delivery is confirmed |
| Device confirms display | Displayed; only if supported by actual device receipts |
| Device unavailable | Device offline or No device assigned; explain delivery impact |
| Loading | Skeletons/placeholders that preserve layout |
| Load failed | Inline error and Retry; do not show an empty success state |
| No questions for day | Nothing scheduled, with a schedule action |

- Distinguish dashboard live connection status from the patient's device connection status.
- Support keyboard navigation, labelled controls, dialog focus management, and screen-reader announcements for new responses without stealing focus.
- Keep existing content visible during background refresh. Use a New response indicator when the caregiver is reading older content.
- Verify text zoom at 200%, long patient names, Thai text, narrow screens, and visible keyboard focus.

## 8. Data and implementation plan

- Read daily `DAILY_CHECK_IN` events from `care_events`; obtain answer details and timestamps from `patient_responses`.
- Continue using `messages` for patient requests where applicable. Do not treat requests as completed daily questions.
- Reuse existing check-in answer validation and `submit_response` rather than sending follow-ups as plain text messages.
- Add an explicit validated parent event/response relationship for follow-up events. Enforce the same patient and organization, and prevent cycles or invalid links.
- Store the question/options snapshot, originating response, creator, and creation time for each follow-up. A template identifier/version can support later reuse.
- Query follow-ups by parent linkage even when answered on a later day; daily question grouping follows the organization's local scheduled date.
- Add server-supported idempotency for creating follow-ups. A disabled browser button alone cannot prevent duplicates after retries.
- Preserve the existing device assignment checks, organization access boundaries, and offline submission behavior.
- Subscribe to the relevant event, response, request, and alert updates; retain current date, filters, and selection during refresh.
- Review delivery receipt support before introducing Delivered or Displayed labels. Backend acceptance alone is not proof the patient saw a question.
- Review status for ordinary answers requires a persisted model if implemented; opening a card must not silently mark an existing alert reviewed.

Likely affected areas: `CheckInsPage.tsx`, `MessageThread.tsx` or its replacement, patient profile response integration, activity APIs/forms, shared types, `global.css`, navigation, Supabase migrations/workflows, and the P-kun patient UI. Locate the actual P-kun UI implementation before estimating that portion; the dashboard alone cannot complete the patient interaction.

## 9. Delivery sequence

1. Correct the daily data source and establish date/status/count rules.
2. Build the patient list and question/answer cards using the proposed visual tokens.
3. Add template selection, answer preview, validated follow-up linkage, and safe sending.
4. Integrate P-kun answer buttons, delivery evidence, and offline responses.
5. Align patient profile links and history with the same question/answer presentation.
6. Verify accessibility, responsive layouts, actual device readability, and the complete data loop.

## 10. Acceptance criteria

- Caregivers see real daily check-in answers with their original questions and timestamps.
- Date changes, midnight boundaries, and patients with no schedule produce accurate results.
- Initial-question progress and follow-up progress remain distinct; requests do not inflate either count.
- Each follow-up is linked to its source answer and has predefined answer options.
- Patients can complete the entire interaction without typing.
- A saved, displayed, answered, and reviewed question is represented accurately with available evidence.
- Offline answers synchronize once without duplication or attachment to a different patient.
- Historical wording/options remain intact when templates change.
- Attention states remain understandable without color; urgent requests remain visible during follow-up.
- Desktop, mobile, keyboard, zoom, Thai text, and actual P-kun screen checks pass.
- End-to-end demonstration: daily question → patient answer → caregiver review → related follow-up → patient taps an answer → linked dashboard response.

## 11. Deferred decisions

- Validate preferred patient language and the actual P-kun screen dimensions during implementation.
- Agree on initial template wording, configured concerning answers, and Answer later reminder behavior with the care team.
- Automatic branching, broader template administration, and trend analytics follow the working manual follow-up flow.
