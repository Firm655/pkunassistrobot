"""Supabase Realtime listener (Phoenix websocket protocol).

A change notification only means "something changed, reconcile now". Notifications can be missed, so
the periodic reconcile in sync.py stays the source of truth. If websocket-client is not installed the
app still works by polling.
"""
import itertools
import json
import logging
import threading
import time

log = logging.getLogger("pkun.realtime")

try:
    import websocket  # websocket-client
except ImportError:  # pragma: no cover
    websocket = None

TABLES = ("care_events", "messages")


class RealtimeListener(threading.Thread):
    def __init__(self, url: str, key: str, token_provider, on_change):
        super().__init__(name="pkun-realtime", daemon=True)
        base = url.replace("https://", "wss://").replace("http://", "ws://")
        self.ws_url = f"{base}/realtime/v1/websocket?apikey={key}&vsn=1.0.0"
        self.token_provider, self.on_change = token_provider, on_change
        self.patient_id: str | None = None
        self.connected = False
        self._stop_event = threading.Event()
        self._ws = None
        self._refs = itertools.count(1)

    @property
    def available(self) -> bool:
        return websocket is not None

    def set_patient(self, patient_id: str | None):
        if patient_id != self.patient_id:
            self.patient_id = patient_id
            self._close()

    def stop(self):
        self._stop_event.set()
        self._close()

    def _close(self):
        ws, self._ws = self._ws, None
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass

    def run(self):
        if websocket is None:
            log.warning("websocket-client not installed; using polling only")
            return
        backoff = 2
        while not self._stop_event.is_set():
            pid, token = self.patient_id, self.token_provider()
            if not pid or not token:
                time.sleep(1)
                continue
            try:
                self._session(pid, token)
                backoff = 2
            except Exception as e:
                log.info("realtime disconnected: %s", e)
            self.connected = False
            if not self._stop_event.is_set():
                self._stop_event.wait(backoff)
                backoff = min(backoff * 2, 60)

    def _send(self, ws, topic, event, payload, ref=None):
        ref = ref or str(next(self._refs))
        ws.send(json.dumps({"topic": topic, "event": event, "payload": payload, "ref": ref, "join_ref": ref}))
        return ref

    def _session(self, pid: str, token: str):
        ws = websocket.create_connection(self.ws_url, timeout=10)
        self._ws = ws
        topic = f"realtime:pkun-{pid}"
        changes = [{"event": "*", "schema": "public", "table": t, "filter": f"patient_id=eq.{pid}"} for t in TABLES]
        join_ref = self._send(ws, topic, "phx_join", {
            "config": {"broadcast": {"self": False}, "presence": {"key": ""}, "postgres_changes": changes},
            "access_token": token,
        })
        ws.settimeout(1)
        last_beat = time.monotonic()
        while not self._stop_event.is_set() and pid == self.patient_id and self._ws is ws:
            if time.monotonic() - last_beat > 25:
                self._send(ws, "phoenix", "heartbeat", {})
                last_beat = time.monotonic()
            fresh = self.token_provider()
            if fresh and fresh != token:
                token = fresh
                self._send(ws, topic, "access_token", {"access_token": token})
            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            if not raw:
                raise ConnectionError("socket closed")
            msg = json.loads(raw)
            event = msg.get("event")
            if event == "phx_reply" and msg.get("ref") == join_ref:
                status = (msg.get("payload") or {}).get("status")
                if status != "ok":
                    raise ConnectionError(f"join rejected: {msg.get('payload')}")
                self.connected = True
                log.info("realtime subscribed for patient %s", pid)
                self.on_change()  # catch up on anything missed while disconnected
            elif event == "postgres_changes":
                self.on_change()
            elif event in ("phx_error", "phx_close"):
                raise ConnectionError(event)
            elif event == "system" and (msg.get("payload") or {}).get("status") == "error":
                log.warning("realtime system error: %s", msg.get("payload"))
