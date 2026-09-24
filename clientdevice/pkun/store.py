"""Local SQLite storage: cached schedule/messages, durable outbox, and local game results.

The outbox is written *before* anything is sent, so a response survives a crash, reboot or network loss.
"""
import json
import sqlite3
import threading
import uuid
from datetime import timedelta
from pathlib import Path

from .timeutil import iso, norm, utcnow

OPEN_STATUSES = ("SCHEDULED", "PENDING")

SCHEMA = """
create table if not exists kv(key text primary key, value text);
create table if not exists events(
  id text primary key, patient_id text not null, event_type text not null, title text not null,
  description text, scheduled_at text not null, due_at text not null, status text not null,
  payload text not null default '{}',
  local_state text            -- null = not handled on this device; 'answered' / 'displayed'
);
create index if not exists events_time on events(scheduled_at);
create table if not exists messages(
  id text primary key, patient_id text not null, message text not null, created_at text not null,
  local_state text            -- null = not shown yet; 'acknowledged'
);
create table if not exists outbox(
  id text primary key, kind text not null, payload text not null, created_at text not null,
  attempts integer not null default 0, last_error text,
  status text not null default 'pending'   -- 'pending' | 'failed' (quarantined for operator review)
);
create table if not exists game_results(
  id integer primary key autoincrement, patient_id text, game text not null, played_at text not null,
  score integer not null, best_length integer not null, rounds_won integer not null, rounds_played integer not null
);
"""


class Store:
    def __init__(self, path: Path | str):
        self._lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        with self._lock:
            if str(path) != ":memory:":
                self.db.execute("pragma journal_mode=wal")
            self.db.executescript(SCHEMA)

    # ---- helpers -----------------------------------------------------------------
    def _exec(self, sql, args=()):
        with self._lock:
            return self.db.execute(sql, args)

    def _rows(self, sql, args=()):
        with self._lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def _row(self, sql, args=()):
        rows = self._rows(sql, args)
        return rows[0] if rows else None

    # ---- key/value ---------------------------------------------------------------
    def get(self, key, default=None):
        row = self._row("select value from kv where key=?", (key,))
        return row["value"] if row else default

    def set(self, key, value):
        if value is None:
            self._exec("delete from kv where key=?", (key,))
        else:
            self._exec("insert into kv(key,value) values(?,?) on conflict(key) do update set value=excluded.value",
                       (key, str(value)))

    # ---- patient cache -----------------------------------------------------------
    def clear_patient_cache(self):
        """Called when the assigned patient changes: never show one patient's data to another."""
        with self._lock:
            self.db.execute("delete from events")
            self.db.execute("delete from messages")

    def sync_events(self, patient_id: str, rows: list, window_start: str, window_end: str):
        with self._lock:
            self.db.execute("begin")
            try:
                ids = []
                for e in rows:
                    ids.append(e["id"])
                    self.db.execute(
                        """insert into events(id,patient_id,event_type,title,description,scheduled_at,due_at,status,payload)
                           values(?,?,?,?,?,?,?,?,?)
                           on conflict(id) do update set title=excluded.title, description=excluded.description,
                             scheduled_at=excluded.scheduled_at, due_at=excluded.due_at, status=excluded.status,
                             payload=excluded.payload, event_type=excluded.event_type""",
                        (e["id"], patient_id, e["event_type"], e["title"], e.get("description"),
                         norm(e["scheduled_at"]), norm(e["due_at"]), e["status"], json.dumps(e.get("payload") or {})))
                marks = ",".join("?" * len(ids)) or "''"
                self.db.execute(f"delete from events where scheduled_at between ? and ? and id not in ({marks})",
                                (window_start, window_end, *ids))
                self.db.execute("delete from events where patient_id <> ?", (patient_id,))
                self.db.execute("delete from events where due_at < ?", (iso(utcnow() - timedelta(days=2)),))
                self.db.execute("commit")
            except Exception:
                self.db.execute("rollback")
                raise

    def sync_messages(self, patient_id: str, rows: list):
        with self._lock:
            self.db.execute("begin")
            try:
                ids = []
                for m in rows:
                    ids.append(m["id"])
                    self.db.execute(
                        """insert into messages(id,patient_id,message,created_at) values(?,?,?,?)
                           on conflict(id) do update set message=excluded.message""",
                        (m["id"], patient_id, m["message"], norm(m["created_at"])))
                marks = ",".join("?" * len(ids)) or "''"
                # Anything the server no longer lists as unacknowledged is finished.
                self.db.execute(f"delete from messages where id not in ({marks})", ids)
                self.db.execute("commit")
            except Exception:
                self.db.execute("rollback")
                raise

    def _event(self, row):
        if row is not None:
            row["payload"] = json.loads(row["payload"] or "{}")
        return row

    def event(self, event_id):
        return self._event(self._row("select * from events where id=?", (event_id,)))

    def due_events(self, now_iso: str) -> list:
        rows = self._rows(
            f"""select * from events where status in {OPEN_STATUSES} and local_state is null
                and scheduled_at <= ? and due_at > ? order by scheduled_at, id""", (now_iso, now_iso))
        return [self._event(r) for r in rows]

    def next_event(self, now_iso: str):
        return self._event(self._row(
            f"""select * from events where status in {OPEN_STATUSES} and local_state is null
                and scheduled_at > ? order by scheduled_at limit 1""", (now_iso,)))

    def mark_event(self, event_id, state):
        self._exec("update events set local_state=? where id=?", (state, event_id))

    def message(self, message_id):
        return self._row("select * from messages where id=?", (message_id,))

    def unread_messages(self) -> list:
        return self._rows("select * from messages where local_state is null order by created_at, id")

    def mark_message(self, message_id, state):
        self._exec("update messages set local_state=? where id=?", (state, message_id))

    # ---- outbox ------------------------------------------------------------------
    def outbox_add(self, kind: str, payload: dict, item_id: str | None = None) -> str:
        item_id = item_id or payload.get("submission_id") or str(uuid.uuid4())
        self._exec("insert or ignore into outbox(id,kind,payload,created_at) values(?,?,?,?)",
                   (item_id, kind, json.dumps(payload), iso(utcnow())))
        return item_id

    def outbox_pending(self) -> list:
        rows = self._rows("select * from outbox where status='pending' order by created_at, rowid")
        for r in rows:
            r["payload"] = json.loads(r["payload"])
        return rows

    def outbox_done(self, item_id):
        self._exec("delete from outbox where id=?", (item_id,))

    def outbox_retry_later(self, item_id, error):
        self._exec("update outbox set attempts=attempts+1, last_error=? where id=?", (str(error), item_id))

    def outbox_quarantine(self, item_id, error):
        self._exec("update outbox set attempts=attempts+1, last_error=?, status='failed' where id=?",
                   (str(error), item_id))

    def outbox_counts(self) -> dict:
        rows = self._rows("select status, count(*) n from outbox group by status")
        counts = {"pending": 0, "failed": 0}
        counts.update({r["status"]: r["n"] for r in rows})
        return counts

    # ---- games (local only; the backend does not store games) ---------------------
    def save_game_result(self, patient_id, game, score, best_length, rounds_won, rounds_played):
        self._exec("""insert into game_results(patient_id,game,played_at,score,best_length,rounds_won,rounds_played)
                      values(?,?,?,?,?,?,?)""",
                   (patient_id, game, iso(utcnow()), score, best_length, rounds_won, rounds_played))

    def best_score(self, patient_id, game):
        row = self._row("select max(score) best from game_results where patient_id is ? and game=?",
                        (patient_id, game))
        return (row or {}).get("best") or 0
