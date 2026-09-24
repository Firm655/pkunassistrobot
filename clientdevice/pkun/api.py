"""Small Supabase client for the device contract in docs/api.md.

Uses only the publishable key plus the device's own Auth session. Never put a service-role key here.
"""
import logging
import threading
import time
from email.utils import parsedate_to_datetime

import requests

log = logging.getLogger("pkun.api")


class NetworkError(Exception):
    """Could not reach Supabase. Always safe to retry later."""


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code

    @property
    def retryable(self) -> bool:
        return self.status >= 500 or self.status in (408, 429)

    @property
    def permission_denied(self) -> bool:
        return self.code == "42501"

    def __str__(self):
        return f"{self.status}: {self.message}"


class AuthError(ApiError):
    """Sign-in rejected (wrong email/password, unconfirmed account)."""


class PkunApi:
    def __init__(self, url: str, key: str, email: str, password: str):
        self.url, self.key, self.email, self.password = url, key, email, password
        self.http = requests.Session()
        self.access_token: str | None = None
        self.refresh_token: str | None = None
        self.expires_at = 0.0
        self.clock_skew: float | None = None
        self._lock = threading.RLock()

    # ---- transport ---------------------------------------------------------------
    def _request(self, method: str, path: str, **kw):
        try:
            r = self.http.request(method, f"{self.url}{path}", timeout=15, **kw)
        except requests.RequestException as e:
            raise NetworkError(str(e)) from e
        try:
            self.clock_skew = time.time() - parsedate_to_datetime(r.headers["Date"]).timestamp()
        except Exception:
            pass
        return r

    @staticmethod
    def _error(r, cls=ApiError):
        try:
            body = r.json()
        except ValueError:
            body = {}
        msg = body.get("message") or body.get("msg") or body.get("error_description") or r.text or r.reason
        return cls(r.status_code, msg, body.get("code") if isinstance(body.get("code"), str) else None)

    # ---- auth --------------------------------------------------------------------
    def _token(self, grant: str, body: dict):
        r = self._request("POST", "/auth/v1/token", params={"grant_type": grant},
                          headers={"apikey": self.key}, json=body)
        if r.status_code >= 400:
            raise self._error(r, AuthError if r.status_code < 500 else ApiError)
        d = r.json()
        self.access_token, self.refresh_token = d["access_token"], d["refresh_token"]
        self.expires_at = time.time() + int(d.get("expires_in", 3600))

    def ensure_session(self):
        with self._lock:
            if self.access_token and time.time() < self.expires_at - 60:
                return
            if self.refresh_token:
                try:
                    self._token("refresh_token", {"refresh_token": self.refresh_token})
                    return
                except AuthError:
                    log.info("refresh token rejected; signing in again")
            self._token("password", {"email": self.email, "password": self.password})

    def _headers(self):
        return {"apikey": self.key, "Authorization": f"Bearer {self.access_token}"}

    # ---- PostgREST ---------------------------------------------------------------
    def rpc(self, name: str, **params):
        self.ensure_session()
        r = self._request("POST", f"/rest/v1/rpc/{name}", headers=self._headers(), json=params)
        if r.status_code >= 400:
            raise self._error(r)
        return r.json() if r.content else None

    def select(self, table: str, params: list):
        self.ensure_session()
        r = self._request("GET", f"/rest/v1/{table}", headers=self._headers(), params=params)
        if r.status_code >= 400:
            raise self._error(r)
        return r.json()

    # ---- device contract ---------------------------------------------------------
    def pair_device(self, code: str, device_name: str):
        """Returns the device UUID, or None when the code is wrong or expired."""
        return self.rpc("pair_device", pairing_code=code, device_name=device_name)

    def device_context(self) -> dict:
        return self.rpc("device_context")

    def heartbeat(self, app_version: str, capabilities: dict):
        return self.rpc("device_heartbeat", app_version=app_version, capabilities=capabilities)

    def events(self, patient_id: str, start_iso: str, end_iso: str, page: int = 500) -> list:
        rows, offset = [], 0
        while True:
            batch = self.select("care_events", [
                ("select", "id,patient_id,event_type,title,description,scheduled_at,due_at,status,payload"),
                ("patient_id", f"eq.{patient_id}"),
                ("scheduled_at", f"gte.{start_iso}"),
                ("scheduled_at", f"lte.{end_iso}"),
                ("order", "scheduled_at.asc,id.asc"),
                ("limit", str(page)), ("offset", str(offset)),
            ])
            rows.extend(batch)
            if len(batch) < page:
                return rows
            offset += page

    def unacknowledged_messages(self, patient_id: str) -> list:
        return self.select("messages", [
            ("select", "id,patient_id,message,message_type,created_at,delivered_at"),
            ("patient_id", f"eq.{patient_id}"),
            ("sender_type", "eq.CARETAKER"),
            ("acknowledged_at", "is.null"),
            ("order", "created_at.asc"),
        ])
