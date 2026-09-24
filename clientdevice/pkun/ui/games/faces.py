"""Face direction game: a face looks up, down, left or right. Depending on the round's rule the patient
presses the SAME direction or the OPPOSITE direction (arrow buttons or arrow keys)."""
import time

from kivy.graphics import Color, Ellipse, Line, Triangle
from kivy.metrics import dp
from kivy.properties import StringProperty
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.gridlayout import GridLayout
from kivy.uix.widget import Widget

from ...game_logic import DirectionGame
from ..theme import ArrowButton, BigButton, Card, Text, color
from .base import BaseGameScreen

TIME_LIMIT = 6.0        # seconds to answer each face before it counts as "too slow"
FEEDBACK_SECONDS = 0.9
VEC = {"up": (0, 1), "down": (0, -1), "left": (-1, 0), "right": (1, 0)}
KEYS = {273: "up", 264: "up", 274: "down", 258: "down", 276: "left", 260: "left", 275: "right", 262: "right"}
RULE_TEXT = {
    "same": ("SAME way", "Press the arrow the SAME way the face is looking.", "ok"),
    "opposite": ("OPPOSITE way", "Press the arrow the OPPOSITE way to where the face is looking.", "warn"),
}


class FaceWidget(Widget):
    """A simple cartoon face turned towards `direction` (drawn, no image files needed)."""
    direction = StringProperty("left")

    def __init__(self, **kw):
        super().__init__(**kw)
        self.skin = (1.0, 0.80, 0.36, 1)
        self.bind(pos=self.redraw, size=self.redraw, direction=self.redraw)

    def redraw(self, *_):
        self.canvas.clear()
        if not self.direction:
            return
        cx, cy = self.center
        r = min(self.width, self.height) * 0.36
        dx, dy = VEC[self.direction]

        with self.canvas:
            # Nose: a wedge sticking out of the head in the looking direction (the clearest cue).
            Color(0.85, 0.60, 0.20, 1)
            if dy == 0:
                Triangle(points=[cx + dx * 1.40 * r, cy - 0.02 * r,
                                 cx + dx * 0.70 * r, cy + 0.20 * r, cx + dx * 0.70 * r, cy - 0.24 * r])
            else:
                Triangle(points=[cx, cy + dy * 1.40 * r,
                                 cx - 0.22 * r, cy + dy * 0.70 * r, cx + 0.22 * r, cy + dy * 0.70 * r])
            Color(*self.skin)
            Ellipse(pos=(cx - r, cy - r), size=(2 * r, 2 * r))
            Color(0.55, 0.36, 0.10, 1)
            Line(circle=(cx, cy, r), width=dp(2))

            # Eyes and mouth move towards the looking direction; pupils look that way too.
            if dy == 0:
                eyes = [(cx + dx * 0.30 * r - 0.22 * r, cy + 0.26 * r), (cx + dx * 0.30 * r + 0.22 * r, cy + 0.26 * r)]
                mouth = (cx + dx * 0.32 * r, cy - 0.42 * r)
            else:
                eyes = [(cx - 0.34 * r, cy + dy * 0.34 * r), (cx + 0.34 * r, cy + dy * 0.34 * r)]
                mouth = (cx, cy - 0.12 * r) if dy > 0 else None
            er, pr = r * 0.16, r * 0.085
            for ex, ey in eyes:
                Color(1, 1, 1, 1)
                Ellipse(pos=(ex - er, ey - er), size=(2 * er, 2 * er))
                Color(0.08, 0.08, 0.08, 1)
                Ellipse(pos=(ex + dx * er * 0.45 - pr, ey + dy * er * 0.45 - pr), size=(2 * pr, 2 * pr))
            if mouth:
                Color(0.55, 0.20, 0.12, 1)
                mx, my = mouth
                Line(points=[mx - 0.22 * r, my, mx + 0.22 * r, my], width=dp(3))


class FaceGameScreen(BaseGameScreen):
    GAME_ID = "face_direction"
    TITLE = "Which way?"
    INTRO = ("A face will look up, down, left or right.\n"
             "Before each round I will tell you the rule:\n"
             "press the SAME way, or the OPPOSITE way.")

    def __init__(self, app, **kw):
        super().__init__(app, name="game_faces", **kw)
        self.game: DirectionGame | None = None
        self.step = None           # rule | face | feedback | summary
        self.face = FaceWidget()
        self.face_card = Card(bg="card", padding=dp(6), size_hint_x=1.1)
        self.face_card.add_widget(self.face)
        self.pad = GridLayout(cols=3, rows=3, spacing=dp(8), size_hint_x=0.9)
        cells = [None, "up", None, "left", None, "right", None, "down", None]
        for d in cells:
            if d is None:
                self.pad.add_widget(Widget())
            else:
                self.pad.add_widget(ArrowButton(d, on_release=lambda b, d=d: self.press(d)))
        self._shown_at = 0.0
        self.show_intro()

    def reset(self):
        self.game, self.step = None, None

    def start(self):
        self.game = DirectionGame()
        self._show_rule()

    # ---- rule card before every round ------------------------------------------------------------
    def _show_rule(self, welcome=False):
        self.cancel_timers()
        self.step = "rule"
        g = self.game
        short, text, fg = RULE_TEXT[g.rule]
        self._update_stats()
        self.info_lbl.text = ("Welcome back! " if welcome else "") + f"Round {g.round_index + 1} of {len(g.rules)}"
        self.info_lbl.color = color("text")
        col = BoxLayout(orientation="vertical", spacing=dp(8))
        head = Card(bg=fg, size_hint_y=None, height=dp(70))
        head.add_widget(Text(short, 40, bold=True))
        col.add_widget(head)
        col.add_widget(Text(text, 28))
        example = "right" if g.rule == "same" else "left"
        col.add_widget(Text(f"Example: face looks RIGHT  ->  press {example.upper()}", 24, fg="muted"))
        row = BoxLayout(size_hint_y=None, height=dp(90))
        row.add_widget(Widget())
        row.add_widget(BigButton("Ready", bg="ok", size=36, on_release=lambda *_: self._next_face()))
        row.add_widget(Widget())
        col.add_widget(row)
        self.set_stage(col)
        self._render_dots()

    # ---- faces ------------------------------------------------------------------------------------
    def _next_face(self):
        if self.step not in ("rule", "feedback"):
            return
        self.cancel_timers()
        self.step = "face"
        short, _, fg = RULE_TEXT[self.game.rule]
        self.info_lbl.text = f"Rule: {short}"
        self.info_lbl.color = color(fg)
        self.face_card.bg = color("card")
        self.face.direction = self.game.next_face()
        self.set_stage(self.face_card, self.pad)
        self._shown_at = time.monotonic()
        self.later(TIME_LIMIT, lambda: self.press(None))
        self.signal("face", direction=self.face.direction)

    def press(self, direction):
        if self.step != "face":
            return
        self.cancel_timers()
        ok = self.game.answer(direction, time.monotonic() - self._shown_at)
        self.signal("correct" if ok else "wrong")
        self.step = "feedback"
        self.face_card.bg = color("ok" if ok else "danger")
        if direction is None:
            self.info_lbl.text = f"Too slow - it was {self.game.expected().upper()}"
        else:
            self.info_lbl.text = "Correct!" if ok else f"Not quite - it was {self.game.expected().upper()}"
        self.info_lbl.color = color("ok" if ok else "warn")
        self._render_dots()
        self._update_stats()
        self.later(FEEDBACK_SECONDS if ok else FEEDBACK_SECONDS * 2, self._after_answer)

    def _after_answer(self):
        g = self.game
        if not g.round_over:
            return self._next_face()
        self.step = "summary"
        got = sum(g.results[g.round_index])
        self.info_lbl.text = ""
        self.set_stage(Text(f"Round {g.round_index + 1}: {got} out of {g.trials_per_round}", 48, bold=True,
                            fg="ok" if got >= g.trials_per_round - 1 else "text"))
        self.later(2.5, self._next_round)

    def _next_round(self):
        g = self.game
        g.next_round()
        if g.finished:
            return self._finish()
        self._show_rule()

    def _finish(self):
        g = self.game
        rts = g.reaction_times
        avg = sum(rts) / len(rts) if rts else None
        per_round = [f"{'Same' if r == 'same' else 'Opposite'}: {sum(res)}/{len(res)}"
                     for r, res in zip(g.rules, g.results)]
        lines = ["   ".join(per_round)]
        if avg:
            lines.append(f"Average answer time: {avg:.1f} s")
        self.finish(g.score, g.max_score, lines,
                    details={"rules": g.rules, "results": g.results, "avg_reaction_s": avg},
                    rounds_played=len(g.rules))

    def on_resume(self):
        if self.game is None:
            return self.show_intro()
        if self.game.round_over:
            self.game.next_round()
            if self.game.finished:
                return self._finish()
        # Show the rule again: the patient may have forgotten it during the interruption.
        self._show_rule(welcome=True)

    # ---- display ------------------------------------------------------------------------------------
    def _update_stats(self):
        if self.game:
            self.stats_lbl.text = f"Score {self.game.score} / {self.game.max_score}"

    def _render_dots(self):
        self.footer.clear_widgets()
        g = self.game
        if not g or g.finished:
            return
        res = g.results[g.round_index]
        for i in range(g.trials_per_round):
            bg = "card" if i >= len(res) else ("ok" if res[i] else "danger")
            dot = Card(bg=bg, padding=0)
            dot.add_widget(Text("" if i >= len(res) else ("OK" if res[i] else "X"), 24, bold=True))
            self.footer.add_widget(dot)

    def game_key(self, key, codepoint):
        if self.step == "face" and key in KEYS:
            self.press(KEYS[key])
            return True
        if self.step == "rule" and key in (13, 271, 32):
            self._next_face()
            return True
        return False
