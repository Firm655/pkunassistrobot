#!/usr/bin/env python3
"""P-kun device test client (VM / Raspberry Pi).

Minimal connectivity test against the Supabase backend using the *device* contract
from docs/api.md. It is NOT the production client: no SQLite cache/outbox, no ROS.

Usage
  python3 pkun_vm_client.py check          # headless: sign in, context, heartbeat, list events
  python3 pkun_vm_client.py pair CODE      # one-time: pair this device account with a code
  python3 pkun_vm_client.py                # Kivy GUI

Config (environment variables or a .env file next to this script)
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PKUN_EMAIL, PKUN_PASSWORD
"""
import json
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

APP_VERSION = "vm-test-0.1"
HERE = Path(__file__).resolve().parent


def load_env():
    env_file = HERE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PKUN_EMAIL", "PKUN_PASSWORD")
               if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing config: {', '.join(missing)} (set them in {env_file} or the environment)")


class ApiError(Exception):
    pass


class PkunClient:
    """Tiny Supabase client: password sign-in, token refresh, RPC and table reads."""

    def __init__(self):
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        self.key = os.environ["SUPABASE_PUBLISHABLE_KEY"]
        self.email = os.environ["PKUN_EMAIL"]
        self.password = os.environ["PKUN_PASSWORD"]
        self.http = requests.Session()
        self.access_token = None
        self.refresh_token = None
        self.expires_at = 0.0
        self.clock_skew = None  # seconds, local minus server
        self.lock = threading.Lock()

    # --- auth -------------------------------------------------------------
    def _token(self, grant, body):
        r = self.http.post(f"{self.url}/auth/v1/token", params={"grant_type": grant},
                           headers={"apikey": self.key}, json=body, timeout=15)
        self._note_skew(r)
        if r.status_code >= 400:
            raise ApiError(f"auth {grant} failed ({r.status_code}): {r.text}")
        d = r.json()
        self.access_token, self.refresh_token = d["access_token"], d["refresh_token"]
        self.expires_at = time.time() + d.get("expires_in", 3600)

    def ensure_session(self):
        with self.lock:
            if self.access_token and time.time() < self.expires_at - 60:
                return
            if self.refresh_token:
                try:
                    self._token("refresh_token", {"refresh_token": self.refresh_token})
                    return
                except ApiError:
                    pass
            self._token("password", {"email": self.email, "password": self.password})

    def _note_skew(self, r):
        try:
            server = parsedate_to_datetime(r.headers["Date"]).timestamp()
            self.clock_skew = time.time() - server
        except Exception:
            pass

    def _headers(self):
        return {"apikey": self.key, "Authorization": f"Bearer {self.access_token}"}

    def _check(self, r):
        self._note_skew(r)
        if r.status_code >= 400:
            try:
                msg = r.json().get("message") or r.text
            except ValueError:
                msg = r.text
            raise ApiError(f"{r.status_code}: {msg}")
        return r.json() if r.content else None

    # --- API ---------------------------------------------------------------
    def rpc(self, name, **params):
        self.ensure_session()
        r = self.http.post(f"{self.url}/rest/v1/rpc/{name}", headers=self._headers(), json=params, timeout=15)
        return self._check(r)

    def select(self, table, params):
        self.ensure_session()
        r = self.http.get(f"{self.url}/rest/v1/{table}", headers=self._headers(), params=params, timeout=15)
        return self._check(r)

    def context(self):
        return self.rpc("device_context")

    def heartbeat(self):
        return self.rpc("device_heartbeat", app_version=APP_VERSION,
                        capabilities={"platform": sys.platform, "vm_test": True})

    def events(self, patient_id, hours_back=12, hours_ahead=24):
        now = datetime.now(timezone.utc)
        return self.select("care_events", [
            ("select", "id,event_type,title,description,scheduled_at,due_at,status,payload"),
            ("patient_id", f"eq.{patient_id}"),
            ("scheduled_at", f"gte.{(now - timedelta(hours=hours_back)).isoformat()}"),
            ("scheduled_at", f"lte.{(now + timedelta(hours=hours_ahead)).isoformat()}"),
            ("order", "scheduled_at.asc"),
        ])

    def messages(self, patient_id):
        return self.select("messages", [
            ("select", "id,message,sender_type,created_at,delivered_at,acknowledged_at"),
            ("patient_id", f"eq.{patient_id}"),
            ("sender_type", "eq.CARETAKER"),
            ("acknowledged_at", "is.null"),
            ("order", "created_at.asc"),
        ])

    def respond(self, patient_id, event_id, response):
        return self.rpc("submit_response", submission_id=str(uuid.uuid4()), patient_id=patient_id,
                        event_id=event_id, response=response, response_data={},
                        response_time=datetime.now(timezone.utc).isoformat())

    def request_help(self, patient_id, code="HELP"):
        return self.rpc("send_patient_request", submission_id=str(uuid.uuid4()),
                        patient_id=patient_id, request_code=code)


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def local_time(s, tz_name="Asia/Bangkok"):
    try:
        from zoneinfo import ZoneInfo
        return parse_ts(s).astimezone(ZoneInfo(tz_name)).strftime("%a %H:%M")
    except Exception:
        return s


def response_options(ev):
    t = ev["event_type"]
    if t in ("MEDICINE", "MEAL"):
        return ["YES", "NO"]
    if t == "TASK":
        return ["DISPLAYED"]
    if t == "DAILY_CHECK_IN":
        return list(ev.get("payload", {}).get("answers", []))
    return []


def can_respond(ev):
    if ev["status"] not in ("SCHEDULED", "PENDING", "MISSED"):
        return False
    # The server rejects responses earlier than 5 minutes before scheduled_at.
    return datetime.now(timezone.utc) >= parse_ts(ev["scheduled_at"]) - timedelta(minutes=5)


# --- CLI ---------------------------------------------------------------------
def cmd_check(c):
    c.ensure_session()
    print(f"[ok] signed in as {c.email}")
    if c.clock_skew is not None:
        flag = "  <-- FIX THE VM CLOCK" if abs(c.clock_skew) > 30 else ""
        print(f"[..] clock skew vs server: {c.clock_skew:+.1f}s{flag}")
    ctx = c.context()
    print(f"[ok] device_context: {json.dumps(ctx)}")
    print(f"[ok] heartbeat accepted, server last_seen = {c.heartbeat()}")
    pid = ctx.get("patient_id")
    if not pid:
        print("[!!] device is paired but has no assigned patient yet")
        return
    evs = c.events(pid)
    print(f"[ok] {len(evs)} event(s) in window:")
    for e in evs:
        print(f"     {local_time(e['scheduled_at'], ctx.get('timezone') or 'Asia/Bangkok')}  "
              f"{e['event_type']:<15} {e['status']:<10} {e['title']}")
    msgs = c.messages(pid)
    print(f"[ok] {len(msgs)} unacknowledged caregiver message(s)")


def cmd_pair(c, code):
    c.ensure_session()
    device_id = c.rpc("pair_device", pairing_code=code, device_name="P-kun VM")
    print(f"[ok] paired. device_id = {device_id}")


# --- GUI ---------------------------------------------------------------------
def run_gui(c):
    from kivy.app import App
    from kivy.clock import Clock, mainthread
    from kivy.uix.boxlayout import BoxLayout
    from kivy.uix.button import Button
    from kivy.uix.label import Label
    from kivy.uix.scrollview import ScrollView

    class PkunApp(App):
        title = "P-kun VM test"

        def build(self):
            self.ctx = None
            root = BoxLayout(orientation="vertical", padding=12, spacing=8)
            self.status = Label(text="Connecting...", size_hint_y=None, height=60, halign="left")
            self.status.bind(size=lambda w, s: setattr(w, "text_size", s))
            root.add_widget(self.status)
            bar = BoxLayout(size_hint_y=None, height=50, spacing=8)
            bar.add_widget(Button(text="Refresh", on_release=lambda *_: self.refresh()))
            bar.add_widget(Button(text="HELP request", on_release=lambda *_: self.bg(self._help)))
            root.add_widget(bar)
            self.list = BoxLayout(orientation="vertical", size_hint_y=None, spacing=6)
            self.list.bind(minimum_height=self.list.setter("height"))
            sv = ScrollView()
            sv.add_widget(self.list)
            root.add_widget(sv)
            self.refresh()
            Clock.schedule_interval(lambda dt: self.refresh(), 30)
            Clock.schedule_interval(lambda dt: self.bg(c.heartbeat), 60)
            return root

        def bg(self, fn, *args):
            def work():
                try:
                    fn(*args)
                except Exception as e:  # show every failure on screen
                    self.set_status(f"[color=ff5555]Error:[/color] {e}")
            threading.Thread(target=work, daemon=True).start()

        def refresh(self):
            self.bg(self._refresh)

        def _refresh(self):
            ctx = c.context()
            if self.ctx and ctx.get("patient_id") != self.ctx.get("patient_id"):
                self.show_events([])  # assignment changed: drop old patient's data
            self.ctx = ctx
            c.heartbeat()
            pid = ctx.get("patient_id")
            if not pid:
                self.set_status("Paired, but no patient assigned yet.")
                self.show_events([])
                return
            evs = c.events(pid)
            msgs = c.messages(pid)
            skew = f" | clock skew {c.clock_skew:+.0f}s" if c.clock_skew is not None else ""
            self.set_status(f"Patient: {ctx.get('patient_name')} | {len(evs)} events | "
                            f"{len(msgs)} new messages | {datetime.now():%H:%M:%S}{skew}")
            self.show_events(evs)

        def _respond(self, ev, answer):
            c.respond(self.ctx["patient_id"], ev["id"], answer)
            self._refresh()

        def _help(self):
            if not self.ctx or not self.ctx.get("patient_id"):
                raise ApiError("no patient assigned")
            c.request_help(self.ctx["patient_id"])
            self.set_status("HELP request sent.")

        @mainthread
        def set_status(self, text):
            self.status.markup = True
            self.status.text = text

        @mainthread
        def show_events(self, evs):
            self.list.clear_widgets()
            tz = (self.ctx or {}).get("timezone") or "Asia/Bangkok"
            for ev in evs:
                row = BoxLayout(size_hint_y=None, height=48, spacing=6)
                row.add_widget(Label(text=f"{local_time(ev['scheduled_at'], tz)}  {ev['title']}  [{ev['status']}]",
                                     size_hint_x=0.6))
                if can_respond(ev):
                    for opt in response_options(ev):
                        row.add_widget(Button(text=opt, on_release=lambda _b, e=ev, o=opt: self.bg(self._respond, e, o)))
                self.list.add_widget(row)

    PkunApp().run()


if __name__ == "__main__":
    load_env()
    client = PkunClient()
    args = sys.argv[1:]
    try:
        if args[:1] == ["check"]:
            cmd_check(client)
        elif args[:1] == ["pair"] and len(args) == 2:
            cmd_pair(client, args[1])
        elif not args:
            run_gui(client)
        else:
            sys.exit(__doc__)
    except ApiError as e:
        sys.exit(f"[!!] {e}")
    except requests.RequestException as e:
        sys.exit(f"[!!] network error (can the VM reach {client.url}?): {e}")