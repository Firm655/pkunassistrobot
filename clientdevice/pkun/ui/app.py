"""P-kun Kivy application: screen routing and the notification override."""
import logging

from kivy.app import App
from kivy.clock import Clock
from kivy.core.window import Window
from kivy.uix.screenmanager import FadeTransition, ScreenManager

from ..presenter import pending_items, still_valid, thank_you
from ..robot import RobotBridge
from ..store import Store
from ..sync import SyncEngine
from ..timeutil import iso, utcnow
from .games.colors import ColorGameScreen
from .games.faces import FaceGameScreen
from .games.memory import MemoryGameScreen
from .screens import ContactScreen, HomeScreen, PromptScreen, SetupScreen
from .theme import COLORS

log = logging.getLogger("pkun.app")


class PkunApp(App):
    title = "P-kun"

    def __init__(self, cfg, engine=None, store=None, robot=None, **kw):
        super().__init__(**kw)
        self.cfg = cfg
        self.store = store or Store(cfg.data_dir / "pkun.db")
        self.robot = robot or RobotBridge()
        self.engine = engine or SyncEngine(cfg, self.store, robot=self.robot)
        self.engine.on_change = lambda: Clock.schedule_once(lambda dt: self._engine_changed())
        self.status = self.engine.snapshot()
        self.active = None          # the notification currently on screen
        self.return_to = "home"     # where to go when notifications are done

    def build(self):
        Window.clearcolor = COLORS["bg"]
        self.sm = ScreenManager(transition=FadeTransition(duration=0.15))
        self.home = HomeScreen(self)
        self.setup = SetupScreen(self)
        self.contact = ContactScreen(self)
        self.prompt = PromptScreen(self)
        self.games = {g.name: g for g in (MemoryGameScreen(self), FaceGameScreen(self), ColorGameScreen(self))}
        for s in (self.home, self.setup, self.contact, self.prompt, *self.games.values()):
            self.sm.add_widget(s)
        self.sm.current = "home"
        Clock.schedule_interval(self._tick, 1.0)
        self._tick(0)
        self.engine.start()
        return self.sm

    def on_stop(self):
        self.engine.stop()

    # ---- navigation ------------------------------------------------------------------
    def go(self, name):
        if self.active is not None and name != "prompt":
            return  # a notification is on screen; it decides where to go next
        self.sm.current = name

    def open_game(self, name):
        self.go(name)

    # ---- engine state ------------------------------------------------------------------
    def _engine_changed(self):
        self.status = self.engine.snapshot()
        state = self.status["state"]
        self.setup.set_status(self.status)
        if state in ("unpaired", "revoked") and self.sm.current != "setup":
            self._drop_active()
            self.sm.current = "setup"
        elif state not in ("unpaired", "revoked") and self.sm.current == "setup" and state != "starting":
            self.sm.current = "home"
        self._refresh_home()

    def _refresh_home(self):
        now = utcnow()
        self.home.update(now, self.status, self.store.next_event(iso(now)))

    # ---- the notification override -------------------------------------------------------
    def _tick(self, _dt):
        self._refresh_home()
        if self.sm.current == "setup" or not self.status.get("patient_id"):
            return
        now = utcnow()
        if self.active is not None:
            if not still_valid(self.store, self.active, now):
                log.info("notification %s no longer valid; closing", self.active.key)
                self._finish_active()
            return
        items = pending_items(self.store, now)
        if items:
            self._present(items[0])

    def _present(self, item):
        current = self.sm.current
        if current in self.games:
            self.games[current].interrupt()   # notifications override every game
            self.return_to = current
        elif current != "prompt":
            self.return_to = "home"
        self.active = item
        log.info("presenting %s", item.key)
        self.robot.signal("notify", kind=item.kind)
        if item.kind == "MESSAGE":
            self.engine.message_shown(item.ref_id)
        self.prompt.show(item, on_choice=self._on_choice, on_timeout=self._on_timeout)
        self.sm.current = "prompt"

    def _on_choice(self, value):
        item = self.active
        if item is None or item.answered:
            return
        item.answered = True
        if item.kind == "MESSAGE":
            self.engine.message_acknowledged(item.ref_id)
        else:
            self.engine.submit_response(item.ref_id, value)
        self.robot.signal("response", kind=item.kind, answer=value)
        self.prompt.show_thanks(thank_you(item, value), then=self._finish_active)

    def _on_timeout(self):
        item = self.active
        if item is not None and item.kind == "TASK" and not item.answered:
            item.answered = True
            self.engine.submit_response(item.ref_id, "DISPLAYED")
        self._finish_active()

    def _finish_active(self):
        self.active = None
        items = pending_items(self.store, utcnow())
        if items:
            self._present(items[0])
            return
        back, self.return_to = self.return_to, "home"
        self.sm.current = back
        if back in self.games:
            self.games[back].resume()

    def _drop_active(self):
        self.active = None
        self.return_to = "home"
