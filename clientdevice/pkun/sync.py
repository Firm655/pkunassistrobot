"""Background synchronization with Supabase.

All network calls run on one worker thread. The UI only reads the local Store and queues work, so the
screen never freezes and keeps working offline. Order on every reconcile (docs/api.md, "At startup/reconnect"):
  1. refresh Auth, device_context; clear the cache if the patient changed
  2. heartbeat (at most once a minute)
  3. refresh the schedule window and unacknowledged caregiver messages
  4. replay the outbox with unchanged submission IDs and timestamps
"""
import logging
import queue
import sys
import threading
import time
import uuid
from datetime import timedelta

from .api import ApiError, AuthError, NetworkError, PkunApi
from .realtime import RealtimeListener
from .timeutil import iso, utcnow

log = logging.getLogger("pkun.sync")

RECONCILE_EVERY = 30      # seconds, even with Realtime (notifications can be missed)
OFFLINE_RETRY_EVERY = 10
HEARTBEAT_EVERY = 60      # server throttles writes to 30 s
WINDOW_BACK = timedelta(hours=12)
WINDOW_AHEAD = timedelta(hours=48)


class SyncEngine:
    def __init__(self, cfg, store, robot=None, api=None, on_change=None, realtime=True):
        self.cfg, self.store, self.robot = cfg, store, robot
        self.api = api or PkunApi(cfg.supabase_url, cfg.publishable_key, cfg.email, cfg.password)
        self.on_change = on_change or (lambda: None)
        self._q: queue.Queue = queue.Queue()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="pkun-sync", daemon=True)
        self._last_heartbeat = 0.0
        self.realtime = (RealtimeListener(cfg.supabase_url, cfg.publishable_key,
                                          lambda: self.api.access_token, self.request_reconcile)
                         if realtime else None)
        # State shown on screen. Patient comes from the cache so the device works after an offline reboot.
        self.state = "starting"
        self.online = False
        self.message = ""
        self.last_sync = None
        self.patient_id = store.get("patient_id")
        self.patient_name = store.get("patient_name")
        self.timezone = store.get("timezone")

    # ---- lifecycle ---------------------------------------------------------------
    def start(self):
        self._thread.start()
        if self.realtime:
            self.realtime.start()

    def stop(self):
        self._stop.set()
        self._q.put(("stop", None))
        if self.realtime:
            self.realtime.stop()

    def snapshot(self) -> dict:
        counts = self.store.outbox_counts()
        return {
            "state": self.state, "online": self.online, "message": self.message,
            "patient_id": self.patient_id, "patient_name": self.patient_name, "timezone": self.timezone,
            "device_id": self.store.get("device_id"), "last_sync": self.last_sync,
            "outbox_pending": counts["pending"], "outbox_failed": counts["failed"],
            "realtime": bool(self.realtime and self.realtime.connected),
        }

    # ---- called from the UI thread (fast, local only) -------------------------------
    def request_reconcile(self):
        self._q.put(("reconcile", None))

    def request_flush(self):
        self._q.put(("flush", None))

    def pair(self, code: str, callback):
        """callback(ok: bool, message: str) is called from the worker thread."""
        self._q.put(("pair", (code, callback)))

    def submit_response(self, event_id: str, answer: str, response_data: dict | None = None):
        ev = self.store.event(event_id)
        if ev is None:
            return
        self.store.mark_event(event_id, "displayed" if answer == "DISPLAYED" else "answered")
        self.store.outbox_add("response", {
            "submission_id": str(uuid.uuid4()), "patient_id": ev["patient_id"], "event_id": event_id,
            "response": answer, "response_data": response_data or {}, "response_time": iso(utcnow()),
        })
        self.request_flush()

    def message_shown(self, message_id: str):
        msg = self.store.message(message_id)
        if msg:
            self.store.outbox_add("ack", {"message_id": message_id, "patient_id": msg["patient_id"],
                                          "acknowledged": False}, item_id=f"delivered:{message_id}")
            self.request_flush()

    def message_acknowledged(self, message_id: str):
        msg = self.store.message(message_id)
        if msg:
            self.store.mark_message(message_id, "acknowledged")
            self.store.outbox_add("ack", {"message_id": message_id, "patient_id": msg["patient_id"],
                                          "acknowledged": True}, item_id=f"ack:{message_id}")
            self.request_flush()

    def send_request(self, code: str) -> bool:
        """Queue a HELP/HUNGRY/NOT_RIGHT request. Returns False if no patient is assigned."""
        if not self.patient_id:
            return False
        self.store.outbox_add("request", {"submission_id": str(uuid.uuid4()), "patient_id": self.patient_id,
                                          "request_code": code})
        self.request_flush()
        return True

    # ---- worker thread -----------------------------------------------------------
    def _loop(self):
        next_reconcile = 0.0
        while not self._stop.is_set():
            timeout = max(0.1, min(1.0, next_reconcile - time.monotonic()))
            jobs = []
            try:
                jobs.append(self._q.get(timeout=timeout))
                while True:
                    jobs.append(self._q.get_nowait())
            except queue.Empty:
                pass
            if any(kind == "stop" for kind, _ in jobs):
                return
            reconcile = time.monotonic() >= next_reconcile or any(kind == "reconcile" for kind, _ in jobs)
            try:
                for kind, arg in jobs:
                    if kind == "pair":
                        reconcile = self._pair(*arg) or reconcile
                if reconcile:
                    self._reconcile()
                elif any(kind == "flush" for kind, _ in jobs) and self.state == "ready":
                    self._flush()
                    self._set_online(True)
                if reconcile:
                    next_reconcile = time.monotonic() + RECONCILE_EVERY
            except NetworkError as e:
                log.info("offline: %s", e)
                self._set_online(False, "")
                next_reconcile = time.monotonic() + OFFLINE_RETRY_EVERY
            except AuthError as e:
                self._set_state("auth_failed", f"Cannot sign in ({e.message}). Check PKUN_EMAIL / PKUN_PASSWORD.")
                self._set_online(True)
                next_reconcile = time.monotonic() + 60
            except Exception as e:  # never let the worker die
                log.exception("sync error")
                self._set_state(self.state, f"Sync problem: {e}")
                next_reconcile = time.monotonic() + OFFLINE_RETRY_EVERY
            self._notify()

    def _notify(self):
        try:
            self.on_change()
        except Exception:
            log.exception("on_change failed")

    def _set_state(self, state, message=""):
        self.state, self.message = state, message

    def _set_online(self, online, message=None):
        self.online = online
        if message is not None:
            self.message = message

    def _pair(self, code, callback) -> bool:
        try:
            device_id = self.api.pair_device(code, self.cfg.device_name)
        except NetworkError:
            callback(False, "No internet connection. Check the network and try again.")
            raise
        except AuthError as e:
            callback(False, f"This P-kun cannot sign in: {e.message}")
            raise
        except ApiError as e:
            callback(False, e.message)
            return False
        if not device_id:
            callback(False, "Wrong or expired code. Ask for a new code and try again.")
            return False
        self.store.set("device_id", device_id)
        callback(True, "Paired!")
        return True

    def _reconcile(self):
        # 1. Auth + assignment
        try:
            ctx = self.api.device_context()
        except ApiError as e:
            if not e.permission_denied:
                raise
            revoked = self.store.get("device_id") is not None
            self._set_state("revoked" if revoked else "unpaired",
                            "This P-kun was removed from the care team." if revoked else "")
            self._set_online(True)
            self._assign(None, None, None)
            return
        self._set_online(True)
        self.store.set("device_id", ctx.get("device_id"))
        self._assign(ctx.get("patient_id"), ctx.get("patient_name"), ctx.get("timezone"))

        # 2. Heartbeat
        if time.monotonic() - self._last_heartbeat >= HEARTBEAT_EVERY:
            self.api.heartbeat(self.cfg.app_version, {
                "display": True, "games": ["remember_the_number"], "numpad": False,
                "robot": bool(self.robot and self.robot.available), "platform": sys.platform,
            })
            self._last_heartbeat = time.monotonic()

        # 3. Schedule + messages
        if self.patient_id:
            now = utcnow()
            start, end = iso(now - WINDOW_BACK), iso(now + WINDOW_AHEAD)
            self.store.sync_events(self.patient_id, self.api.events(self.patient_id, start, end), start, end)
            self.store.sync_messages(self.patient_id, self.api.unacknowledged_messages(self.patient_id))
            self._set_state("ready", "")
        else:
            self._set_state("no_patient", "No patient assigned to this P-kun yet.")

        # 4. Outbox
        self._flush()
        self.last_sync = utcnow()

    def _assign(self, patient_id, name, tz):
        if patient_id != self.store.get("patient_id"):
            log.info("patient assignment changed -> clearing local cache")
            self.store.clear_patient_cache()
        self.patient_id, self.patient_name, self.timezone = patient_id, name, tz or self.timezone
        self.store.set("patient_id", patient_id)
        self.store.set("patient_name", name)
        self.store.set("timezone", self.timezone)
        if self.realtime:
            self.realtime.set_patient(patient_id)

    def _flush(self):
        for item in self.store.outbox_pending():
            p = item["payload"]
            try:
                if item["kind"] == "response":
                    self.api.rpc("submit_response", **p)
                elif item["kind"] == "request":
                    self.api.rpc("send_patient_request", **p)
                elif item["kind"] == "ack":
                    self.api.rpc("acknowledge_message", **p)
                else:
                    raise ApiError(0, f"unknown outbox kind {item['kind']}")
            except NetworkError:
                raise
            except AuthError:
                raise
            except ApiError as e:
                if e.retryable:
                    self.store.outbox_retry_later(item["id"], e)
                    return
                # Assignment/revocation/validation errors: keep for review, never re-target the patient.
                log.warning("outbox item %s quarantined: %s", item["id"], e)
                self.store.outbox_quarantine(item["id"], e)
            else:
                self.store.outbox_done(item["id"])
