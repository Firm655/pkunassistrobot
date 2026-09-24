"""Run with:  python3 -m unittest discover -s tests -v   (no Kivy or network needed)"""
import random
import unittest
from datetime import timedelta
from types import SimpleNamespace

from pkun.api import ApiError, NetworkError
from pkun.game_logic import MemoryGame, wheel_step
from pkun.presenter import pending_items, still_valid
from pkun.store import Store
from pkun.sync import SyncEngine
from pkun.timeutil import iso, utcnow

PID = "11111111-1111-1111-1111-111111111111"


def ev(i, minutes_from_now, etype="MEDICINE", status="SCHEDULED", payload=None):
    now = utcnow()
    return {"id": f"e{i}", "patient_id": PID, "event_type": etype, "title": f"Event {i}", "description": None,
            "scheduled_at": iso(now + timedelta(minutes=minutes_from_now)),
            "due_at": iso(now + timedelta(minutes=minutes_from_now + 60)), "status": status,
            "payload": payload or {"name": "Vitamin C", "dosage": "1 tablet"}}


class GameTests(unittest.TestCase):
    def test_wheel_wraps(self):
        self.assertEqual(wheel_step(9, 1), 1)
        self.assertEqual(wheel_step(1, -1), 9)
        self.assertEqual(wheel_step(5, 3), 8)

    def test_round_flow(self):
        g = MemoryGame(rng=random.Random(1))
        seq = g.new_round()
        self.assertEqual(len(seq), 3)
        self.assertTrue(all(1 <= d <= 9 for d in seq))
        self.assertTrue(all(a != b for a, b in zip(seq, seq[1:])))
        self.assertEqual(g.submit(seq[0]), "correct")
        self.assertEqual(g.submit(seq[1]), "correct")
        self.assertEqual(g.submit(seq[2]), "round_complete")
        self.assertEqual((g.score, g.length, g.rounds_won), (3, 4, 1))

    def test_three_mistakes_end_game(self):
        g = MemoryGame(rng=random.Random(2))
        for _ in range(3):
            seq = g.new_round()
            self.assertEqual(g.submit(wheel_step(seq[0], 1)), "wrong")
        self.assertTrue(g.finished)

    def test_restart_round_replays_same_sequence(self):
        g = MemoryGame(rng=random.Random(3))
        seq = g.new_round()
        g.submit(seq[0])
        g.restart_round()
        self.assertEqual((g.sequence, g.position), (seq, 0))


class PresenterTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        now = utcnow()
        self.window = (iso(now - timedelta(hours=12)), iso(now + timedelta(hours=48)))

    def test_due_events_and_messages_order(self):
        self.store.sync_events(PID, [ev(1, -5), ev(2, 30), ev(3, -2, "TASK"),
                                     ev(4, -1, status="COMPLETED")], *self.window)
        self.store.sync_messages(PID, [{"id": "m1", "message": "Hello", "created_at": iso(utcnow())}])
        keys = [i.key for i in pending_items(self.store, utcnow())]
        self.assertEqual(keys, ["message:m1", "event:e1", "event:e3"])
        self.assertEqual(self.store.next_event(iso(utcnow()))["id"], "e2")

    def test_answered_locally_is_not_shown_again_after_resync(self):
        self.store.sync_events(PID, [ev(1, -5)], *self.window)
        self.store.mark_event("e1", "answered")
        self.store.sync_events(PID, [ev(1, -5)], *self.window)  # server has not processed it yet
        self.assertEqual(pending_items(self.store, utcnow()), [])

    def test_item_invalid_when_skipped_on_server(self):
        self.store.sync_events(PID, [ev(1, -5)], *self.window)
        item = pending_items(self.store, utcnow())[0]
        self.assertTrue(still_valid(self.store, item, utcnow()))
        self.store.sync_events(PID, [ev(1, -5, status="SKIPPED")], *self.window)
        self.assertFalse(still_valid(self.store, item, utcnow()))

    def test_check_in_options(self):
        payload = {"answers": ["Fine", "Unwell"], "concerning_answers": ["Unwell"]}
        self.store.sync_events(PID, [ev(1, -1, "DAILY_CHECK_IN", payload=payload)], *self.window)
        item = pending_items(self.store, utcnow())[0]
        self.assertEqual([o[1] for o in item.options], ["Fine", "Unwell"])


class FakeApi:
    def __init__(self):
        self.calls, self.offline, self.fail_with = [], False, None
        self.access_token = "t"

    def rpc(self, name, **p):
        if self.offline:
            raise NetworkError("down")
        if self.fail_with:
            raise self.fail_with
        self.calls.append((name, p))

    def device_context(self):
        return {"device_id": "d1", "patient_id": PID, "patient_name": "Test", "timezone": "Asia/Bangkok"}

    def heartbeat(self, *a):
        self.calls.append(("heartbeat", a))

    def events(self, *a):
        return [ev(1, -5)]

    def unacknowledged_messages(self, *a):
        return []


class OutboxTests(unittest.TestCase):
    def setUp(self):
        cfg = SimpleNamespace(supabase_url="https://x", publishable_key="k", email="e", password="p",
                              device_name="P-kun", app_version="test")
        self.store, self.api = Store(":memory:"), FakeApi()
        self.engine = SyncEngine(cfg, self.store, api=self.api, realtime=False)

    def test_offline_answer_is_kept_and_replayed_unchanged(self):
        self.engine._reconcile()
        self.engine.submit_response("e1", "NO")
        queued = self.store.outbox_pending()[0]["payload"]
        self.api.offline = True
        with self.assertRaises(NetworkError):
            self.engine._flush()
        self.assertEqual(self.store.outbox_counts()["pending"], 1)
        self.api.offline = False
        self.engine._flush()
        name, sent = self.api.calls[-1]
        self.assertEqual(name, "submit_response")
        self.assertEqual(sent, queued)  # same submission_id and response_time
        self.assertEqual(self.store.outbox_counts()["pending"], 0)

    def test_validation_error_is_quarantined(self):
        self.engine._reconcile()
        self.engine.submit_response("e1", "YES")
        self.api.fail_with = ApiError(400, "Event is already closed")
        self.engine._flush()
        self.assertEqual(self.store.outbox_counts(), {"pending": 0, "failed": 1})

    def test_patient_change_clears_cache(self):
        self.engine._reconcile()
        self.assertIsNotNone(self.store.event("e1"))
        self.api.device_context = lambda: {"device_id": "d1", "patient_id": None}
        self.engine._reconcile()
        self.assertIsNone(self.store.event("e1"))
        self.assertEqual(self.engine.state, "no_patient")

    def test_unpaired_device(self):
        def denied():
            raise ApiError(403, "Device authentication required", "42501")
        self.api.device_context = denied
        self.engine._reconcile()
        self.assertEqual(self.engine.state, "unpaired")


if __name__ == "__main__":
    unittest.main()
