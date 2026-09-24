"""Shared frame for all games: title bar with Home, instructions, intro and result screens,
and the interrupt/resume contract used when a notification overrides the game."""
from kivy.clock import Clock
from kivy.metrics import dp
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.widget import Widget

from ..screens import KeyScreen
from ..theme import BigButton, Text


class BaseGameScreen(KeyScreen):
    GAME_ID = ""
    TITLE = ""
    INTRO = ""

    def __init__(self, app, name, **kw):
        super().__init__(name=name, **kw)
        self.app = app
        self.phase = "intro"      # intro | playing | finished (subclasses may use more)
        self.paused = False
        self._events = []

        root = BoxLayout(orientation="vertical", padding=dp(14), spacing=dp(8))
        top = BoxLayout(size_hint_y=None, height=dp(52), spacing=dp(10))
        top.add_widget(Text(self.TITLE, 28, bold=True, halign="left"))
        self.stats_lbl = Text("", 22, fg="muted", halign="right")
        top.add_widget(self.stats_lbl)
        top.add_widget(BigButton("Home", bg="neutral", size=22, size_hint_x=None, width=dp(110),
                                 on_release=lambda *_: self.quit()))
        root.add_widget(top)
        self.info_lbl = Text("", 26, size_hint_y=None, height=dp(44))
        root.add_widget(self.info_lbl)
        self.stage = BoxLayout(spacing=dp(14))
        root.add_widget(self.stage)
        self.footer = BoxLayout(size_hint_y=None, height=dp(58), spacing=dp(8))
        root.add_widget(self.footer)
        self.add_widget(root)

    # ---- helpers ----------------------------------------------------------------------
    def later(self, seconds, fn):
        ev = Clock.schedule_once(lambda dt: fn(), seconds)
        self._events.append(ev)
        return ev

    def cancel_timers(self):
        for ev in self._events:
            ev.cancel()
        self._events = []

    def set_stage(self, *widgets):
        self.stage.clear_widgets()
        for w in widgets:
            if w.parent:
                w.parent.remove_widget(w)
            self.stage.add_widget(w)

    def signal(self, state, **data):
        self.app.robot.signal("game", game=self.GAME_ID, state=state, **data)

    # ---- intro / result ------------------------------------------------------------------
    def show_intro(self):
        self.cancel_timers()
        self.phase, self.paused = "intro", False
        self.reset()
        best = self.app.store.best_score(self.app.engine.patient_id, self.GAME_ID)
        self.stats_lbl.text = f"Best score: {best}" if best else ""
        self.info_lbl.text = ""
        self.footer.clear_widgets()
        col = BoxLayout(orientation="vertical", spacing=dp(12))
        col.add_widget(Text(self.INTRO, 27))
        row = BoxLayout(size_hint_y=None, height=dp(110))
        row.add_widget(Widget())
        row.add_widget(BigButton("Start", bg="ok", size=40, on_release=lambda *_: self.begin()))
        row.add_widget(Widget())
        col.add_widget(row)
        self.set_stage(col)

    def begin(self):
        self.cancel_timers()
        self.phase, self.paused = "playing", False
        self.signal("start")
        self.start()

    def finish(self, score, max_score=None, lines=(), details=None, **extra):
        self.cancel_timers()
        self.phase = "finished"
        self.app.store.save_game_result(self.app.engine.patient_id, self.GAME_ID, score,
                                        max_score=max_score, details=details, **extra)
        self.signal("finished", score=score)
        self.info_lbl.text = ""
        self.footer.clear_widgets()
        col = BoxLayout(orientation="vertical", spacing=dp(10))
        col.add_widget(Text(f"Score: {score}" + (f" / {max_score}" if max_score else ""), 56, bold=True))
        for line in lines:
            col.add_widget(Text(line, 26, fg="muted"))
        row = BoxLayout(size_hint_y=None, height=dp(100), spacing=dp(14))
        row.add_widget(BigButton("Play again", bg="ok", size=32, on_release=lambda *_: self.begin()))
        row.add_widget(BigButton("Home", bg="neutral", size=32, on_release=lambda *_: self.quit()))
        col.add_widget(row)
        self.set_stage(col)

    def quit(self):
        self.cancel_timers()
        self.show_intro()
        self.app.go("home")

    def on_pre_enter(self, *_):
        if self.phase == "finished":
            self.show_intro()

    # ---- interruption by notifications -----------------------------------------------------
    def interrupt(self):
        self.cancel_timers()
        if self.phase not in ("intro", "finished"):
            self.paused = True

    def resume(self):
        if self.paused:
            self.paused = False
            self.on_resume()

    # ---- keys ------------------------------------------------------------------------------
    def on_key(self, key, codepoint):
        if self.phase in ("intro", "finished"):
            if key in (13, 271):
                self.begin()
                return True
            return False
        return self.game_key(key, codepoint)

    # ---- for subclasses ------------------------------------------------------------------------
    def reset(self):
        """Forget the current game (called when showing the intro)."""

    def start(self):
        raise NotImplementedError

    def on_resume(self):
        raise NotImplementedError

    def game_key(self, key, codepoint):
        return False
