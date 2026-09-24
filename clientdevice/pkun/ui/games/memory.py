"""'Remember the number': digits flash one at a time, then the patient scrolls a 1-9 wheel to each one.

After an interruption the current round is replayed from the start, because nobody can be expected to
remember digits across a medicine reminder.
"""
from kivy.metrics import dp
from kivy.uix.boxlayout import BoxLayout

from ...game_logic import MemoryGame, wheel_step
from ..theme import ArrowButton, BigButton, Card, Text, color
from .base import BaseGameScreen

SHOW_SECONDS = 1.0     # each digit is visible this long ("quickly")
GAP_SECONDS = 0.35     # blank between digits so repeats are visible
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
        card = Card(bg="primary", size_hint_y=0.28, padding=0)
        self.cur_lbl = Text("", 72, bold=True)
        card.add_widget(self.cur_lbl)
        self.add_widget(card)
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
        self.prev_lbl.text = str(wheel_step(self.value, 1))   # above: scrolling up brings it in
        self.next_lbl.text = str(wheel_step(self.value, -1))

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


class MemoryGameScreen(BaseGameScreen):
    GAME_ID = "remember_the_number"
    TITLE = "Remember the number"
    INTRO = ("I will show some numbers, one at a time.\nRemember them!\n"
             "Then scroll to each number and press OK.")

    def __init__(self, app, **kw):
        super().__init__(app, name="game_memory", **kw)
        self.game: MemoryGame | None = None
        self.step = None           # showing | answering | feedback
        self.flash_lbl = Text("", 190, bold=True)
        self.wheel = NumberWheel(size_hint_x=1.2, on_change=lambda v: self.signal("scroll"))
        self.ok_btn = BigButton("OK", bg="ok", size=44, on_release=lambda *_: self.answer())
        self.show_intro()

    def reset(self):
        self.game, self.step = None, None

    def start(self):
        self.game = MemoryGame()
        self._new_round()

    def _new_round(self):
        self.game.new_round()
        self._show_sequence()

    def _show_sequence(self, intro="Watch the numbers..."):
        self.cancel_timers()
        self.step = "showing"
        self._update_stats()
        self.info_lbl.text = intro
        self.info_lbl.color = color("text")
        self.flash_lbl.text = ""
        self.set_stage(self.flash_lbl)
        self._render_slots(show_all=False)
        t = 1.0
        for i, digit in enumerate(self.game.sequence):
            self.later(t, lambda d=digit, n=i: self._flash(d, n))
            t += SHOW_SECONDS
            self.later(t, lambda: setattr(self.flash_lbl, "text", ""))
            t += GAP_SECONDS
        self.later(t, self._start_answer)

    def _flash(self, digit, index):
        self.flash_lbl.text = str(digit)
        self.info_lbl.text = f"Number {index + 1} of {len(self.game.sequence)}"

    def _start_answer(self):
        self.step = "answering"
        self.wheel.reset()
        self.set_stage(self.wheel, self.ok_btn)
        self._prompt_position()

    def _prompt_position(self):
        self.info_lbl.text = f"Scroll to number {self.game.position + 1} of {len(self.game.sequence)}, then press OK"
        self.info_lbl.color = color("text")
        self._render_slots(show_all=False)

    def answer(self):
        if self.step != "answering":
            return
        result = self.game.submit(self.wheel.value)
        self.signal(result)
        if result == "correct":
            self.wheel.reset()
            self._prompt_position()
            return
        self.step = "feedback"
        self._update_stats()
        if result == "round_complete":
            self._render_slots(show_all=True)
            self.info_lbl.text = "Well done! Next round has one more number."
            self.info_lbl.color = color("ok")
            self.set_stage(Text("Correct!", 80, bold=True, fg="ok"))
            self.later(2.5, self._new_round)
            return
        self._render_slots(show_all=True, wrong_at=self.game.position)
        self.info_lbl.color = color("warn")
        self.set_stage(Text(f"It was {self.game.target}", 64, bold=True, fg="warn"))
        if self.game.finished:
            self.info_lbl.text = "The numbers are shown below."
            self.later(3.0, self._finish)
        else:
            self.info_lbl.text = "Not quite - the numbers are shown below. Let's try again."
            self.later(3.5, self._new_round)

    def _finish(self):
        g = self.game
        self.finish(g.score, lines=[f"Longest sequence remembered: {g.best_length or '-'}"],
                    best_length=g.best_length, rounds_won=g.rounds_won, rounds_played=g.rounds_played)

    def on_resume(self):
        if self.game is None:
            return self.show_intro()
        if self.game.finished:
            self._finish()
        elif self.step == "feedback":
            self._new_round()          # the round had already ended; carry on
        else:
            self.game.restart_round()
            self._show_sequence("Welcome back! Let's watch the same numbers again...")

    def _update_stats(self):
        if self.game:
            self.stats_lbl.text = f"Score {self.game.score}    Lives left {self.game.lives}"

    def _render_slots(self, show_all, wrong_at=None):
        self.footer.clear_widgets()
        if not self.game or not self.game.sequence:
            return
        for i, digit in enumerate(self.game.sequence):
            done = i < self.game.position
            if show_all or done:
                text = str(digit)
                bg = "danger" if i == wrong_at else ("ok" if (done or wrong_at is None) else "neutral")
            else:
                text, bg = ("?" if i == self.game.position and self.step == "answering" else ""), "card"
            slot = Card(bg=bg, padding=0)
            slot.add_widget(Text(text, 30, bold=True))
            self.footer.add_widget(slot)

    def game_key(self, key, codepoint):
        if self.step != "answering":
            return False
        if key in (273, 264, 43):        # up arrow, numpad 8, '+'
            self.wheel.step(1)
        elif key in (274, 258, 45):      # down arrow, numpad 2, '-'
            self.wheel.step(-1)
        elif key in (13, 271, 32):       # Enter, numpad Enter, space
            self.answer()
        else:
            return False
        return True
