# P-kun device app

This is the patient-facing Kivy app for the Raspberry Pi. You can also run it on the Ubuntu VM or a laptop. It follows the device contract in `../docs/api.md` and the P-kun sections of `../docs/specification.json`.

## Run it

Python 3.10 or newer.

```sh
cd clientdevice
python3 -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # then fill in PKUN_EMAIL / PKUN_PASSWORD
python3 main.py
```

- **First start:** if the device account isn't paired yet, the setup screen opens. On the caretaker dashboard, go to Devices and create a pairing code. Type the 6 digits on the on-screen keypad (or a keyboard or numpad) and press OK.
- **Pairing works once per account.** Each device account can be paired only once, and a revoked device needs a new account.
- **Kiosk mode on the Pi:** set `PKUN_FULLSCREEN=1`.
- **Thai or Japanese text:** set `PKUN_FONT` to a Noto font. The default font can't draw those characters.
- **Start again:** `python3 main.py --reset` clears the local cache and outbox.
- **Tests** (no screen or network needed): `python3 -m unittest discover -s tests -v`

## Screens

| Screen | What it does |
| --- | --- |
| Home | Time, date, next activity and a notification area. **Contact caretaker** is in the top-right corner, and the three game buttons are along the bottom. |
| Notification | One interaction at a time: medicine and meal (Yes/No), daily check-in (the configured answers), task reminder (shown for 15 s, then fades out and sends `DISPLAYED`), caregiver message (OK, which acknowledges it). |
| Contact caretaker | *I need help* / *I'm hungry* / *Something isn't right*, followed by a confirmation. |
| Games | Number game, Which way?, Color game (see below). |
| Setup | Pairing with the 6-digit code. |

## Notifications override everything

Once a second the app checks the local cache for work that is due now:
1. Unacknowledged caregiver messages, oldest first.
2. Events whose `scheduled_at` has passed and whose `due_at` hasn't, in schedule order.

If anything is due, it takes over the screen whatever the patient is doing, and any game pauses. After the last notification the patient goes back to the same game, which resumes as follows:

| Game | After an interruption |
| --- | --- |
| Number game | Replays the **same numbers** from the start of the round. |
| Which way? | Shows the round's **rule again**, then continues with the remaining faces. |
| Color game | Skips the unanswered question (not scored) and continues. |

A notification closes on its own if the server skips it or it passes its deadline.

## Games

All three games share `pkun/ui/games/base.py`, which provides the intro screen, the result screen, the Home button and interrupt/resume. Results are saved on the Pi only (`game_results` in `data/pkun.db`, with `score`, `max_score` and a JSON `details` column), because the backend doesn't store games.

**Number game** (`games/memory.py`)
- P-kun flashes 3 digits (1–9), one at a time.
- The patient scrolls a number wheel to each digit and presses OK. Scrolling works with the arrows, by swiping, or with the up/down keys.
- A correct round makes the next one a digit longer (up to 9); a mistake makes it a digit shorter. Three mistakes end the game.

**Which way?** (`games/faces.py`)
- A drawn face looks up, down, left or right. Its nose points the way it is looking.
- Before each round a card shows the rule: **SAME way** (green) or **OPPOSITE way** (orange). The patient presses Ready when they've understood it.
- The patient presses the matching arrow on screen, or an arrow key (numpad 8/2/4/6 also work).
- There are 3 rounds of 6 faces with 6 s per face. Round 1 is always SAME, and OPPOSITE appears at least once.
- Results record per-round scores and the average answer time.

**Color game** (`games/colors.py`)
- A colored box has a *different* color's name written on it. The patient picks the color of the **box**, not the word. This is a Stroop test.
- The four answer buttons always include the box color and the written word.
- There are 10 questions with 10 s each. Keys 1–4 also choose an answer.
- Results record how often the patient chose the written word and the average answer time. Red and green both appear, so tell staff if a patient is color-blind.

Timings are constants at the top of each game file. Rounds, trials and lives are the defaults in `pkun/game_logic.py`.

## Sync and offline behaviour

- All network calls run on one background thread (`pkun/sync.py`), so the screen never freezes.
- The app reconciles with the server every 30 s, and straight away when Realtime reports a change on `care_events` or `messages`. Realtime is only a signal to reconcile now; without `websocket-client` the app still works by polling.
- Each reconcile does the following, in order:
  1. Sign in or refresh the session, then call `device_context`. If the assigned patient changed, the local cache is cleared.
  2. Send a heartbeat (at most once a minute).
  3. Cache the schedule from 12 h ago to 48 h ahead, plus unacknowledged messages, in SQLite.
  4. Replay the outbox.
- Every answer, request and acknowledgement is written to the SQLite **outbox before sending**, with a fixed `submission_id` and `response_time`, and replayed unchanged when the network returns.
  - Network or server errors are retried.
  - Validation, assignment or revocation errors are kept as `failed` for staff to check, and never re-sent to a different patient. The home screen shows the count.

## Robot hooks

`pkun/robot.py` publishes UI events as JSON on the ROS 2 topic `/pkun/ui_event` when `rclpy` is available (notify, response, request, game). Without ROS they are only logged. The robot-side nodes aren't written yet.

## Files

```
main.py                 start-up, logging, Kivy window settings
pkun/config.py          .env settings
pkun/api.py             Supabase REST/RPC client (device contract)
pkun/store.py           SQLite cache, outbox, local game results
pkun/sync.py            background sync engine
pkun/realtime.py        Supabase Realtime listener
pkun/presenter.py       what must be shown now (notification rules)
pkun/game_logic.py      rules for all three games
pkun/robot.py           ROS 2 bridge
pkun/ui/app.py          screen routing and the notification override
pkun/ui/screens.py      home, setup, contact, notification screens
pkun/ui/games/          base.py + memory.py, faces.py, colors.py
pkun/ui/theme.py        large high-contrast widgets
tests/test_logic.py     unit tests
```

Logs are in `data/pkun.log`.
