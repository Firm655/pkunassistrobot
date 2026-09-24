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
    """Sign-in rejected (wrong email/password, unconfirmed or deleted account)."""


class NotSignedIn(Exception):
    """This Pi has no device account yet (never paired, removed, or its local data was wiped).
    The fix is always the same: pair with a new code."""


CLAIM_FUNCTION = "/functions/v1/claim-device"


class PkunApi:
    """Two ways a Pi gets its account:
      * paired with a code (default): the Pi sends the 6-digit code to the claim-device Edge Function, which
        creates the Pi's own account on the server and returns its internal login. The Pi keeps that login in
        its local database (token_store) and signs in with it like any account. No email is needed.
      * email/password in .env: a dedicated Auth account made by hand (the original setup).
    """

    def __init__(self, url: str, key: str, email: str | None = None, password: str | None = None,
                 token_store=None):
        self.url, self.key = url, key
        self.token_store = token_store     # object with get(key) / set(key, value), e.g. the SQLite Store
        self.claimed = not (email and password)
        if self.claimed and token_store is not None:
            email, password = token_store.get("device_email"), token_store.get("device_password")
        self.email, self.password = email, password
        self.http = requests.Session()
        self.access_token: str | None = None
        self.refresh_token: str | None = token_store.get("refresh_token") if token_store else None
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
        msg = (body.get("message") or body.get("msg") or body.get("error_description") or body.get("error")
               or r.text or r.reason)
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
        if self.token_store is not None:   # refresh tokens rotate; keep the newest (saves a sign-in per boot)
            self.token_store.set("refresh_token", self.refresh_token)

    @property
    def has_identity(self) -> bool:
        return bool(self.email and self.password)

    def ensure_session(self):
        with self._lock:
            if self.access_token and time.time() < self.expires_at - 60:
                return
            if self.refresh_token:
                try:
                    self._token("refresh_token", {"refresh_token": self.refresh_token})
                    return
                except AuthError as e:
                    log.info("refresh token rejected (%s); signing in with the device login", e)
                    self.refresh_token = None
            if not self.has_identity:
                raise NotSignedIn("not paired")
            try:
                self._token("password", {"email": self.email, "password": self.password})
            except AuthError:
                if self.claimed:          # the device account was deleted on the server
                    self.forget_identity()
                    raise NotSignedIn("device account no longer exists")
                raise

    def claim_device(self, code: str, device_name: str) -> str:
        """Pair using only the code. Returns the device UUID; stores this Pi's new login locally."""
        with self._lock:
            r = self._request("POST", CLAIM_FUNCTION, headers={"apikey": self.key},
                              json={"pairing_code": code, "device_name": device_name})
            if r.status_code == 404:
                raise ApiError(404, "The pairing service is not set up yet (deploy the claim-device function).")
            if r.status_code >= 400:
                raise self._error(r)
            d = r.json()
            self.forget_identity()
            self.email, self.password = d["email"], d["password"]
            if self.token_store is not None:
                self.token_store.set("device_email", self.email)
                self.token_store.set("device_password", self.password)
            return d["device_id"]

    def forget_identity(self):
        """Drop this Pi's login (it was removed, or is about to pair again)."""
        with self._lock:
            self.access_token = self.refresh_token = None
            self.expires_at = 0.0
            if self.claimed:
                self.email = self.password = None
            if self.token_store is not None:
                self.token_store.set("refresh_token", None)
                if self.claimed:
                    self.token_store.set("device_email", None)
                    self.token_store.set("device_password", None)

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
