"""Color game (Stroop test): a colored box has a *different* colour's name written on it.
The patient chooses the color of the box, not the word."""
import time

from kivy.metrics import dp
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.gridlayout import GridLayout

from ...game_logic import ColorGame
from ..theme import BigButton, Card, Text, color, ink_for
from .base import BaseGameScreen

TIME_LIMIT = 10.0
FEEDBACK_SECONDS = 1.0


class ColorGameScreen(BaseGameScreen):
    GAME_ID = "color_box"
    TITLE = "Color of the box"
    INTRO = ("A colored box will have a word written on it.\n"
             "Choose the COLOR OF THE BOX.\nDo not read the word!")

    def __init__(self, app, **kw):
        super().__init__(app, name="game_colors", **kw)
        self.game: ColorGame | None = None
        self.step = None             # trial | feedback
        self.box = Card(bg="card", size_hint_y=1.2, padding=0)
        self.word_lbl = Text("", 76, bold=True)
        self.box.add_widget(self.word_lbl)
        self.buttons = GridLayout(cols=4, spacing=dp(10), size_hint_y=None, height=dp(96))
        self.trial_view = BoxLayout(orientation="vertical", spacing=dp(12))
        self.trial_view.add_widget(self.box)
        self.trial_view.add_widget(self.buttons)
        self._shown_at = 0.0
        self.show_intro()

    def reset(self):
        self.game, self.step = None, None

    def start(self):
        self.game = ColorGame()
        self._next_trial()

    def _next_trial(self):
        self.cancel_timers()
        g = self.game
        if g.finished:
            return self._finish()
        background, word, options = g.new_trial()
        self.step = "trial"
        self.info_lbl.text = "Choose the color of the BOX"
        self.info_lbl.color = color("text")
        self.box.bg = color(background)
        self.word_lbl.text = word.upper()
        self.word_lbl.color = ink_for(color(background))
        self.buttons.clear_widgets()
        for i, name in enumerate(options):
            self.buttons.add_widget(BigButton(name, bg=name, size=28,
                                              on_release=lambda b, n=name: self.choose(n)))
        self.set_stage(self.trial_view)
        self._update_stats()
        self._render_progress()
        self._shown_at = time.monotonic()
        self.later(TIME_LIMIT, lambda: self.choose(None))
        self.signal("trial", background=background, word=word)

    def choose(self, name):
        if self.step != "trial":
            return
        self.cancel_timers()
        g = self.game
        ok = g.answer(name, time.monotonic() - self._shown_at)
        self.signal("correct" if ok else "wrong")
        self.step = "feedback"
        if ok:
            self.info_lbl.text, fg = "Correct!", "ok"
        elif name is None:
            self.info_lbl.text, fg = f"Too slow - the box was {g.background.upper()}", "warn"
        elif name == g.word:
            self.info_lbl.text, fg = f"That was the word. The box was {g.background.upper()}", "warn"
        else:
            self.info_lbl.text, fg = f"Not quite - the box was {g.background.upper()}", "warn"
        self.info_lbl.color = color(fg)
        self._update_stats()
        self._render_progress()
        self.later(FEEDBACK_SECONDS if ok else FEEDBACK_SECONDS * 2.2, self._next_trial)

    def _finish(self):
        g = self.game
        rts = g.reaction_times
        avg = sum(rts) / len(rts) if rts else None
        lines = [f"Chose the word instead of the box: {g.picked_word} time(s)"]
        if avg:
            lines.append(f"Average answer time: {avg:.1f} s")
        self.finish(g.correct, g.trials, lines,
                    details={"picked_word": g.picked_word, "avg_reaction_s": avg}, rounds_played=g.trials)

    def on_resume(self):
        if self.game is None:
            return self.show_intro()
        # The trial on screen when we were interrupted is replaced by a fresh one (not scored).
        self.info_lbl.text = "Welcome back!"
        self.later(1.5, self._next_trial)

    def _update_stats(self):
        if self.game:
            self.stats_lbl.text = f"Score {self.game.correct} / {self.game.trials}"

    def _render_progress(self):
        self.footer.clear_widgets()
        g = self.game
        for i in range(g.trials):
            if i < len(g.results):
                bg = "ok" if g.results[i] else "danger"
            else:
                bg = "neutral" if i == g.index and self.step == "trial" else "card"
            self.footer.add_widget(Card(bg=bg, padding=0))

    def game_key(self, key, codepoint):
        if self.step != "trial":
            return False
        digit = int(codepoint) if codepoint and codepoint.isdigit() else (key - 256 if 256 <= key <= 265 else None)
        if digit and 1 <= digit <= len(self.game.options):
            self.choose(self.game.options[digit - 1])
            return True
        return False
