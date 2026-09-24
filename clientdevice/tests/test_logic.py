"""Run with:  python3 -m unittest discover -s tests -v   (no Kivy or network needed)"""
import random
import unittest
from datetime import timedelta
from types import SimpleNamespace

from pkun.api import ApiError, NetworkError
from pkun.game_logic import OPPOSITE, ColorGame, DirectionGame, MemoryGame, wheel_step
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


class DirectionGameTests(unittest.TestCase):
    def test_rules_start_with_same_and_include_opposite(self):
        for seed in range(20):
            g = DirectionGame(rng=random.Random(seed))
            self.assertEqual(g.rules[0], "same")
            self.assertIn("opposite", g.rules)

    def test_same_and_opposite_scoring(self):
        g = DirectionGame(rounds=2, trials_per_round=2, rng=random.Random(4))
        g.rules = ["same", "opposite"]
        face = g.next_face()
        self.assertTrue(g.answer(face))
        face = g.next_face()
        self.assertFalse(g.answer(OPPOSITE[face]))
        self.assertTrue(g.round_over)
        g.next_round()
        face = g.next_face()
        self.assertTrue(g.answer(OPPOSITE[face]))
        g.next_face()
        self.assertFalse(g.answer(None))           # too slow
        g.next_round()
        self.assertTrue(g.finished)
        self.assertEqual((g.score, g.max_score), (2, 4))

    def test_face_never_repeats_immediately(self):
        g = DirectionGame(rng=random.Random(5))
        faces = [g.next_face() for _ in range(50)]
        self.assertTrue(all(a != b for a, b in zip(faces, faces[1:])))


class ColorGameTests(unittest.TestCase):
    def test_word_never_matches_box_and_both_are_options(self):
        g = ColorGame(trials=200, rng=random.Random(6))
        for _ in range(200):
            bg, word, opts = g.new_trial()
            self.assertNotEqual(bg, word)
            self.assertIn(bg, opts)
            self.assertIn(word, opts)
            self.assertEqual(len(set(opts)), 4)
            g.answer(bg)
        self.assertTrue(g.finished)
        self.assertEqual(g.correct, 200)

    def test_choosing_the_word_is_counted(self):
        g = ColorGame(trials=2, rng=random.Random(7))
        _, word, _ = g.new_trial()
        self.assertFalse(g.answer(word))
        g.new_trial()
        self.assertFalse(g.answer(None))
        self.assertEqual((g.correct, g.picked_word, g.results), (0, 1, [False, False]))


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
    claimed = False            # behaves like an email-account Pi
    has_identity = True

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


class StoreTests(unittest.TestCase):
    def test_old_game_table_is_upgraded(self):
        import os, sqlite3, tempfile
        path = os.path.join(tempfile.mkdtemp(), "old.db")
        db = sqlite3.connect(path)
        db.execute("""create table game_results(id integer primary key autoincrement, patient_id text,
            game text not null, played_at text not null, score integer not null, best_length integer not null,
            rounds_won integer not null, rounds_played integer not null)""")
        db.commit()
        db.close()
        store = Store(path)
        store.save_game_result(PID, "color_box", 8, max_score=10, details={"picked_word": 1})
        self.assertEqual(store.best_score(PID, "color_box"), 8)


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


# ------------------------------------------------------------------------ pairing without email accounts
from pkun.api import AuthError, NotSignedIn, PkunApi  # noqa: E402


class ClaimFakeApi(FakeApi):
    """FakeApi for a Pi paired by code: the 'server' creates one account per successful claim."""

    def __init__(self):
        super().__init__()
        self.claimed = True
        self.login = None
        self.accounts_created = 0
        self.valid_code = "482913"
        self.revoked = False

    @property
    def has_identity(self):
        return self.login is not None

    def claim_device(self, code, name):
        if code != self.valid_code:
            raise ApiError(400, "Wrong or expired code. Ask for a new code and try again.")
        self.accounts_created += 1
        self.login = f"device-{self.accounts_created}"
        self.revoked = False
        return f"device-id-{self.accounts_created}"

    def device_context(self):
        if self.revoked:
            raise ApiError(403, "Device authentication required", "42501")
        return super().device_context()


class CodePairingTests(unittest.TestCase):
    def setUp(self):
        cfg = SimpleNamespace(supabase_url="https://x", publishable_key="k", email=None, password=None,
                              device_name="P-kun", app_version="test")
        self.store, self.api = Store(":memory:"), ClaimFakeApi()
        self.engine = SyncEngine(cfg, self.store, api=self.api, realtime=False)
        self.results = []
        self.cb = lambda ok, msg: self.results.append((ok, msg))

    def test_new_pi_is_unpaired_without_network(self):
        with self.assertRaises(NotSignedIn):
            self.engine._reconcile()
        self.engine._lost_identity()
        self.assertEqual(self.engine.state, "unpaired")
        self.assertEqual(self.api.calls, [])

    def test_wrong_code_creates_no_account(self):
        self.assertFalse(self.engine._pair("000000", self.cb))
        self.assertEqual(self.api.accounts_created, 0)
        self.assertIn("Wrong or expired", self.results[-1][1])
        self.assertTrue(self.engine._pair("482913", self.cb))
        self.assertEqual(self.store.get("device_id"), "device-id-1")
        self.engine._reconcile()
        self.assertEqual(self.engine.state, "ready")

    def test_removed_pi_pairs_again_with_a_new_code(self):
        self.engine._pair("482913", self.cb)
        self.engine._reconcile()
        self.api.revoked = True
        self.engine._reconcile()
        self.assertEqual(self.engine.state, "revoked")
        self.assertIsNone(self.store.event("e1"))           # old patient's data cleared
        self.assertTrue(self.engine._pair("482913", self.cb))
        self.engine._reconcile()
        self.assertEqual((self.engine.state, self.api.accounts_created), ("ready", 2))


class FakeResponse:
    def __init__(self, status, body):
        import json
        self.status_code, self._body = status, body
        self.headers, self.reason = {}, ""
        self.text = json.dumps(body)
        self.content = self.text.encode()

    def json(self):
        return self._body


def fake_server(routes):
    """routes: {path: FakeResponse or callable(kwargs)}; records calls."""
    calls = []

    def request(method, path, **kw):
        calls.append((path, kw.get("params"), kw.get("json")))
        r = routes[path]
        return r(kw) if callable(r) else r
    return request, calls


class DeviceLoginTests(unittest.TestCase):
    def test_claim_stores_login_and_survives_restart(self):
        store = Store(":memory:")
        api = PkunApi("https://x", "k", token_store=store)
        self.assertTrue(api.claimed)
        self.assertFalse(api.has_identity)
        with self.assertRaises(NotSignedIn):
            api.ensure_session()
        api._request, calls = fake_server({"/functions/v1/claim-device": FakeResponse(
            200, {"device_id": "d1", "email": "device-1@devices.pkun.invalid", "password": "p" * 48})})
        self.assertEqual(api.claim_device("482 913", "Ward 3"), "d1")
        self.assertEqual(calls[0][2], {"pairing_code": "482 913", "device_name": "Ward 3"})
        self.assertEqual(store.get("device_email"), "device-1@devices.pkun.invalid")
        # "Restart": a new client reads the stored login and signs in with it.
        api2 = PkunApi("https://x", "k", token_store=store)
        self.assertTrue(api2.has_identity)
        api2._request, calls2 = fake_server({"/auth/v1/token": FakeResponse(
            200, {"access_token": "a", "refresh_token": "r", "expires_in": 3600})})
        api2.ensure_session()
        self.assertEqual(calls2[0][1], {"grant_type": "password"})
        self.assertEqual(calls2[0][2]["email"], "device-1@devices.pkun.invalid")
        self.assertEqual(store.get("refresh_token"), "r")

    def test_lost_refresh_token_falls_back_to_device_login(self):
        store = Store(":memory:")
        for k, v in (("device_email", "d@devices.pkun.invalid"), ("device_password", "pw"), ("refresh_token", "old")):
            store.set(k, v)
        api = PkunApi("https://x", "k", token_store=store)

        def token(kw):
            if kw["params"]["grant_type"] == "refresh_token":
                return FakeResponse(400, {"message": "Invalid Refresh Token: Already Used"})
            return FakeResponse(200, {"access_token": "a2", "refresh_token": "r2"})
        api._request, calls = fake_server({"/auth/v1/token": token})
        api.ensure_session()
        self.assertEqual([c[1]["grant_type"] for c in calls], ["refresh_token", "password"])
        self.assertEqual(api.access_token, "a2")

    def test_deleted_device_account_means_pair_again(self):
        store = Store(":memory:")
        store.set("device_email", "d@devices.pkun.invalid")
        store.set("device_password", "pw")
        api = PkunApi("https://x", "k", token_store=store)
        api._request, _ = fake_server({"/auth/v1/token": FakeResponse(400, {"message": "Invalid login credentials"})})
        with self.assertRaises(NotSignedIn):
            api.ensure_session()
        self.assertIsNone(store.get("device_email"))

    def test_claim_errors_are_readable(self):
        api = PkunApi("https://x", "k", token_store=Store(":memory:"))
        api._request, _ = fake_server({"/functions/v1/claim-device": FakeResponse(
            429, {"error": "Too many wrong codes. Wait 10 minutes and try again."})})
        with self.assertRaises(ApiError) as ctx:
            api.claim_device("000000", "P-kun")
        self.assertIn("Too many wrong codes", ctx.exception.message)
        self.assertTrue(ctx.exception.retryable)
        api._request, _ = fake_server({"/functions/v1/claim-device": FakeResponse(404, {"message": "not found"})})
        with self.assertRaises(ApiError) as ctx:
            api.claim_device("123456", "P-kun")
        self.assertIn("deploy the claim-device function", ctx.exception.message)

    def test_email_mode_still_supported(self):
        store = Store(":memory:")
        api = PkunApi("https://x", "k", "pi@example.com", "secret", token_store=store)
        self.assertFalse(api.claimed)
        api._request, calls = fake_server({"/auth/v1/token": FakeResponse(200, {"access_token": "a", "refresh_token": "r"})})
        api.ensure_session()
        self.assertEqual(calls[0][2]["email"], "pi@example.com")
        api.forget_identity()
        self.assertEqual(api.email, "pi@example.com")      # .env login is never forgotten
