"""'Remember the number' game screen.

Notifications always win: the app calls interrupt() before showing a prompt and resume() afterwards.
After an interruption the current round is replayed from the start, because nobody can be expected to
remember digits across a medicine reminder.
"""
from kivy.clock import Clock
from kivy.metrics import dp
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.widget import Widget

from ..game_logic import MemoryGame, wheel_step
from .screens import KeyScreen
from .theme import ArrowButton, BigButton, Card, Text, color

SHOW_SECONDS = 1.0     # each digit is visible this long ("quickly")
GAP_SECONDS = 0.35     # blank between digits so repeats of the same digit are visible
START_DIGIT = 1        # wheel position at the start of every answer
SWIPE_STEP = dp(45)    # finger travel per digit when scrolling


class NumberWheel(BoxLayout):
    """Scrollable 1-9 wheel: arrows, swipe up/down, or keyboard up/down."""

    def __init__(self, on_change=None, **kw):
        super().__init__(orientation="vertical", spacing=dp(4), **kw)
        self.value = START_DIGIT
        self.on_change = on_change
        self.add_widget(ArrowButton("up", size_hint_y=0.22, on_release=lambda *_: self.step(1)))
        self.prev_lbl = Text("", 30, fg="muted", size_hint_y=0.14)
        self.add_widget(self.prev_lbl)
        self.card = Card(bg="primary", size_hint_y=0.28, padding=0)
        self.cur_lbl = Text("", 72, bold=True)
        self.card.add_widget(self.cur_lbl)
        self.add_widget(self.card)
        self.next_lbl = Text("", 30, fg="muted", size_hint_y=0.14)
        self.add_widget(self.next_lbl)
        self.add_widget(ArrowButton("down", size_hint_y=0.22, on_release=lambda *_: self.step(-1)))
        self._drag_y = None
        self.render()

    def reset(self):
        self.value = START_DIGIT
        self.render()

    def step(self, n):
        self.value = wheel_step(self.value, n)
        self.render()
        if self.on_change:
            self.on_change(self.value)

    def render(self):
        self.cur_lbl.text = str(self.value)
        self.prev_lbl.text = str(wheel_step(self.value, 1))   # shown above: scrolling up brings it in
        self.next_lbl.text = str(wheel_step(self.value, -1))

    # Swipe anywhere on the wheel (touch screens). Arrow buttons still receive their own taps.
    def on_touch_down(self, touch):
        if self.collide_point(*touch.pos) and not any(
                isinstance(c, ArrowButton) and c.collide_point(*touch.pos) for c in self.children):
            self._drag_y = touch.y
            touch.grab(self)
            return True
        return super().on_touch_down(touch)

    def on_touch_move(self, touch):
        if touch.grab_current is self and self._drag_y is not None:
            moved = touch.y - self._drag_y
            while abs(moved) >= SWIPE_STEP:
                direction = 1 if moved > 0 else -1
                self.step(direction)
                self._drag_y += direction * SWIPE_STEP
                moved = touch.y - self._drag_y
            return True
        return super().on_touch_move(touch)

    def on_touch_up(self, touch):
        if touch.grab_current is self:
            touch.ungrab(self)
            self._drag_y = None
            return True
        return super().on_touch_up(touch)


class GameScreen(KeyScreen):
    def __init__(self, app, **kw):
        super().__init__(name="game", **kw)
        self.app = app
        self.game: MemoryGame | None = None
        self.phase = "intro"          # intro | showing | answering | feedback | finished
        self.paused = False
        self._events = []

        root = BoxLayout(orientation="vertical", padding=dp(14), spacing=dp(8))
        top = BoxLayout(size_hint_y=None, height=dp(52), spacing=dp(10))
        top.add_widget(Text("Remember the number", 28, bold=True, halign="left"))
        self.stats_lbl = Text("", 22, fg="muted", halign="right")
        top.add_widget(self.stats_lbl)
        top.add_widget(BigButton("Home", bg="neutral", size=22, size_hint_x=None, width=dp(110),
                                 on_release=lambda *_: self.quit()))
        root.add_widget(top)

        self.info_lbl = Text("", 26, size_hint_y=None, height=dp(44))
        root.add_widget(self.info_lbl)
        self.stage = BoxLayout(spacing=dp(14))
        root.add_widget(self.stage)
        self.slots = BoxLayout(size_hint_y=None, height=dp(58), spacing=dp(8))
        root.add_widget(self.slots)
        self.add_widget(root)

        self.flash_lbl = Text("", 190, bold=True)
        self.wheel = NumberWheel(size_hint_x=1.2, on_change=lambda v: app.robot.signal("game", state="scroll"))
        self.ok_btn = BigButton("OK", bg="ok", size=44, on_release=lambda *_: self.answer())
        self.show_intro()

    # ---- flow ------------------------------------------------------------------------
    def _later(self, seconds, fn):
        self._events.append(Clock.schedule_once(lambda dt: fn(), seconds))

    def _cancel(self):
        for ev in self._events:
            ev.cancel()
        self._events = []

    def _stage(self, *widgets):
        self.stage.clear_widgets()
        for w in widgets:
            if w.parent:
                w.parent.remove_widget(w)
            self.stage.add_widget(w)

    def show_intro(self):
        self._cancel()
        self.phase, self.game, self.paused = "intro", None, False
        best = self.app.store.best_score(self.app.engine.patient_id, "remember_the_number")
        self.stats_lbl.text = f"Best score: {best}" if best else ""
        self.info_lbl.text = ""
        how = Text("I will show some numbers, one at a time.\nRemember them!\n"
                   "Then scroll to each number and press OK.", 28)
        start = BigButton("Start", bg="ok", size=40, size_hint=(1, None), height=dp(110))
        start.bind(on_release=lambda *_: self.start())
        col = BoxLayout(orientation="vertical", spacing=dp(12))
        col.add_widget(how)
        row = BoxLayout(size_hint_y=None, height=dp(110))
        row.add_widget(Widget())
        row.add_widget(start)
        row.add_widget(Widget())
        col.add_widget(row)
        self._stage(col)
        self._render_slots(show_all=False)

    def start(self):
        self.game = MemoryGame()
        self.app.robot.signal("game", state="start")
        self._new_round()

    def _new_round(self):
        self.game.new_round()
        self._show_sequence()

    def _show_sequence(self, intro="Watch the numbers..."):
        self._cancel()
        self.phase = "showing"
        self._update_stats()
        self.info_lbl.text = intro
        self.flash_lbl.text = ""
        self._stage(self.flash_lbl)
        self._render_slots(show_all=False)
        t = 1.0
        for i, digit in enumerate(self.game.sequence):
            self._later(t, lambda d=digit, n=i: self._flash(d, n))
            t += SHOW_SECONDS
            self._later(t, lambda: setattr(self.flash_lbl, "text", ""))
            t += GAP_SECONDS
        self._later(t, self._start_answer)

    def _flash(self, digit, index):
        self.flash_lbl.text = str(digit)
        self.info_lbl.text = f"Number {index + 1} of {len(self.game.sequence)}"

    def _start_answer(self):
        self.phase = "answering"
        self.wheel.reset()
        self._stage(self.wheel, self.ok_btn)
        self._prompt_position()

    def _prompt_position(self):
        self.info_lbl.text = (f"Scroll to number {self.game.position + 1} of {len(self.game.sequence)}, "
                              f"then press OK")
        self.info_lbl.color = color("text")
        self._render_slots(show_all=False)

    def answer(self):
        if self.phase != "answering":
            return
        result = self.game.submit(self.wheel.value)
        self.app.robot.signal("game", state=result)
        if result == "correct":
            self.wheel.reset()
            self._prompt_position()
        elif result == "round_complete":
            self.phase = "feedback"
            self._render_slots(show_all=True)
            self.info_lbl.text = "Well done! Next round has one more number."
            self.info_lbl.color = color("ok")
            self._stage(Text("Correct!", 80, bold=True, fg="ok"))
            self._update_stats()
            self._later(2.5, self._new_round)
        else:
            self.phase = "feedback"
            self._render_slots(show_all=True, wrong_at=self.game.position)
            self.info_lbl.color = color("warn")
            self._update_stats()
            if self.game.finished:
                self.info_lbl.text = "The numbers were shown below."
                self._later(3.0, self._finish)
            else:
                self.info_lbl.text = "Not quite - the numbers are shown below. Let's try again."
                self._later(3.5, self._new_round)
            self._stage(Text(f"It was {self.game.target}", 64, bold=True, fg="warn"))

    def _finish(self):
        g = self.game
        self.phase = "finished"
        self.app.store.save_game_result(self.app.engine.patient_id, "remember_the_number",
                                        g.score, g.best_length, g.rounds_won, g.rounds_played)
        self.app.robot.signal("game", state="finished", score=g.score)
        self.info_lbl.text = ""
        col = BoxLayout(orientation="vertical", spacing=dp(12))
        col.add_widget(Text(f"Score: {g.score}", 56, bold=True))
        col.add_widget(Text(f"Longest sequence remembered: {g.best_length or '-'}", 26, fg="muted"))
        row = BoxLayout(size_hint_y=None, height=dp(100), spacing=dp(14))
        row.add_widget(BigButton("Play again", bg="ok", size=32, on_release=lambda *_: self.start()))
        row.add_widget(BigButton("Home", bg="neutral", size=32, on_release=lambda *_: self.quit()))
        col.add_widget(row)
        self._stage(col)

    def quit(self):
        self._cancel()
        self.show_intro()
        self.app.go("home")

    # ---- interruption by notifications -------------------------------------------------
    def interrupt(self):
        self._cancel()
        if self.phase in ("showing", "answering", "feedback"):
            self.paused = True

    def resume(self):
        if not self.paused or self.game is None:
            return
        self.paused = False
        if self.game.finished:
            self._finish()
        elif self.phase == "feedback":
            self._new_round()      # the round had already ended; carry on with the next one
        else:
            self.game.restart_round()
            self._show_sequence("Welcome back! Let's watch the same numbers again...")

    # ---- display ---------------------------------------------------------------------
    def _update_stats(self):
        g = self.game
        if g:
            self.stats_lbl.text = f"Score {g.score}    Lives left {g.lives}"

    def _render_slots(self, show_all, wrong_at=None):
        self.slots.clear_widgets()
        if not self.game or not self.game.sequence:
            return
        for i, digit in enumerate(self.game.sequence):
            done = i < self.game.position
            if show_all or done:
                text, bg = str(digit), ("danger" if i == wrong_at else "ok" if (done or wrong_at is None) else "neutral")
            else:
                text, bg = ("?" if i == self.game.position and self.phase == "answering" else ""), "card"
            slot = Card(bg=bg, padding=0)
            slot.add_widget(Text(text, 30, bold=True))
            self.slots.add_widget(slot)

    def on_key(self, key, codepoint):
        if self.phase == "answering":
            if key in (273, 264, 43):        # up arrow, numpad 8, '+'
                self.wheel.step(1)
            elif key in (274, 258, 45):      # down arrow, numpad 2, '-'
                self.wheel.step(-1)
            elif key in (13, 271, 32):       # Enter, numpad Enter, space
                self.answer()
            else:
                return False
            return True
        if self.phase in ("intro", "finished") and key in (13, 271):
            self.start()
            return True
        return False
