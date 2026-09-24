"""Large, high-contrast widgets for elderly users (big text, big buttons, one thing at a time)."""
from kivy.graphics import Color, RoundedRectangle, Triangle
from kivy.metrics import dp, sp
from kivy.properties import ListProperty, StringProperty
from kivy.uix.behaviors import ButtonBehavior
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.label import Label
from kivy.uix.widget import Widget

COLORS = {
    "bg": (0.07, 0.08, 0.10, 1),
    "card": (0.15, 0.17, 0.21, 1),
    "text": (1, 1, 1, 1),
    "muted": (0.72, 0.76, 0.82, 1),
    "primary": (0.18, 0.46, 0.93, 1),
    "ok": (0.12, 0.60, 0.33, 1),
    "warn": (0.90, 0.52, 0.10, 1),
    "danger": (0.82, 0.18, 0.18, 1),
    "neutral": (0.36, 0.39, 0.46, 1),
}


# Colours used by the colour game (clearly different from each other).
GAME_RGBA = {
    "Red": (0.86, 0.14, 0.14, 1), "Blue": (0.13, 0.38, 0.93, 1), "Green": (0.10, 0.62, 0.22, 1),
    "Yellow": (0.98, 0.85, 0.10, 1), "Purple": (0.56, 0.24, 0.80, 1), "Orange": (1.0, 0.52, 0.05, 1),
}


def color(name):
    """Theme colour by name, game colour by name, or an (r, g, b, a) tuple."""
    if isinstance(name, (tuple, list)):
        return tuple(name)
    return COLORS.get(name) or GAME_RGBA.get(name) or COLORS["primary"]


def ink_for(rgba):
    """Black or white text, whichever reads better on this background."""
    r, g, b = rgba[:3]
    return (0.05, 0.05, 0.05, 1) if 0.299 * r + 0.587 * g + 0.114 * b > 0.6 else (1, 1, 1, 1)


class Text(Label):
    """Label that wraps inside its box."""

    def __init__(self, text="", size=24, fg="text", bold=False, halign="center", valign="middle", **kw):
        super().__init__(text=text, font_size=sp(size), color=color(fg), bold=bold,
                         halign=halign, valign=valign, **kw)
        self.bind(size=self._wrap)

    def _wrap(self, *_):
        self.text_size = (self.width, self.height)


class _Rounded:
    bg = ListProperty(COLORS["card"])

    def _init_bg(self, radius=18):
        with self.canvas.before:
            self._bg_color = Color(*self.bg)
            self._bg_rect = RoundedRectangle(radius=[dp(radius)])
        self.bind(pos=self._redraw, size=self._redraw, bg=self._recolor)
        self._redraw()

    def _redraw(self, *_):
        self._bg_rect.pos, self._bg_rect.size = self.pos, self.size

    def _recolor(self, *_):
        self._bg_color.rgba = self.bg


class Card(_Rounded, BoxLayout):
    def __init__(self, bg="card", **kw):
        kw.setdefault("padding", dp(14))
        kw.setdefault("spacing", dp(6))
        super().__init__(**kw)
        self.bg = color(bg)
        self._init_bg()


class BigButton(_Rounded, ButtonBehavior, Label):
    def __init__(self, text="", bg="primary", size=28, **kw):
        super().__init__(text=text, font_size=sp(size), bold=True, halign="center", valign="middle", **kw)
        self.base = color(bg)
        self.bg = self.base
        self._init_bg()
        if isinstance(bg, str) and bg in GAME_RGBA:
            self.color = ink_for(self.base)
        self.bind(size=lambda *_: setattr(self, "text_size", (self.width - dp(16), self.height)),
                  state=self._pressed)

    def set_bg(self, name):
        self.base = color(name)
        self.bg = self.base

    def _pressed(self, *_):
        f = 0.7 if self.state == "down" else 1.0
        r, g, b, a = self.base
        self.bg = (r * f, g * f, b * f, a)


class ArrowButton(_Rounded, ButtonBehavior, Widget):
    """Big triangle button (no font glyph needed)."""
    direction = StringProperty("up")

    def __init__(self, direction="up", **kw):
        super().__init__(**kw)
        self.direction = direction
        self.bg = COLORS["card"]
        self._init_bg()
        with self.canvas:
            Color(*COLORS["text"])
            self._tri = Triangle()
        self.bind(pos=self._draw, size=self._draw, state=self._pressed)
        self._draw()

    def _draw(self, *_):
        cx, cy = self.center
        w, h = min(self.width * 0.22, dp(46)), min(self.height * 0.6, dp(40))
        if self.direction in ("left", "right"):
            w, h = min(self.width * 0.6, dp(40)), min(self.height * 0.22, dp(46))
        d = self.direction
        if d == "up":
            self._tri.points = [cx - w, cy - h / 2, cx + w, cy - h / 2, cx, cy + h / 2]
        elif d == "down":
            self._tri.points = [cx - w, cy + h / 2, cx + w, cy + h / 2, cx, cy - h / 2]
        elif d == "left":
            self._tri.points = [cx + w / 2, cy - h, cx + w / 2, cy + h, cx - w / 2, cy]
        else:
            self._tri.points = [cx - w / 2, cy - h, cx - w / 2, cy + h, cx + w / 2, cy]

    def _pressed(self, *_):
        self.bg = COLORS["neutral"] if self.state == "down" else COLORS["card"]
