"""Home, pairing, contact-caretaker and notification (prompt) screens."""
from kivy.animation import Animation
from kivy.clock import Clock
from kivy.core.window import Window
from kivy.metrics import dp
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.gridlayout import GridLayout
from kivy.uix.progressbar import ProgressBar
from kivy.uix.screenmanager import Screen
from kivy.uix.widget import Widget

from ..timeutil import parse_ts, to_local
from .theme import BigButton, Card, Text, color

REQUESTS = [("HELP", "I need help", "danger"), ("HUNGRY", "I'm hungry", "warn"),
            ("NOT_RIGHT", "Something isn't right", "danger")]


class KeyScreen(Screen):
    """Screen that receives physical keyboard / keypad keys while it is shown."""

    def on_enter(self, *_):
        Window.bind(on_key_down=self._on_key)

    def on_leave(self, *_):
        Window.unbind(on_key_down=self._on_key)

    def _on_key(self, _window, key, _scancode, codepoint, _mods):
        return self.on_key(key, codepoint)

    def on_key(self, key, codepoint):
        return False


def key_digit(key, codepoint):
    if codepoint and codepoint.isdigit():
        return int(codepoint)
    if 256 <= key <= 265:  # numpad 0-9
        return key - 256
    return None


# ------------------------------------------------------------------------------------ home
class HomeScreen(Screen):
    def __init__(self, app, **kw):
        super().__init__(name="home", **kw)
        self.app = app
        root = BoxLayout(orientation="vertical", padding=dp(14), spacing=dp(8))

        # Top: date/status on the left, Contact caretaker in the top-right corner (away from the games).
        top = BoxLayout(size_hint_y=None, height=dp(76), spacing=dp(12))
        left = BoxLayout(orientation="vertical")
        self.date_lbl = Text("", 24, halign="left")
        self.conn_lbl = Text("", 18, fg="muted", halign="left")
        left.add_widget(self.date_lbl)
        left.add_widget(self.conn_lbl)
        top.add_widget(left)
        top.add_widget(BigButton("Contact caretaker", bg="danger", size=26, size_hint_x=None, width=dp(290),
                                 on_release=lambda *_: app.go("contact")))
        root.add_widget(top)

        self.time_lbl = Text("", 84, bold=True, size_hint_y=None, height=dp(96))
        root.add_widget(self.time_lbl)

        nxt = Card(orientation="vertical", size_hint_y=None, height=dp(84))
        nxt.add_widget(Text("Next", 18, fg="muted", halign="left", size_hint_y=None, height=dp(20)))
        self.next_lbl = Text("", 28, bold=True, halign="left")
        nxt.add_widget(self.next_lbl)
        root.add_widget(nxt)

        self.notice_lbl = Text("", 20, fg="warn")  # notification area
        root.add_widget(self.notice_lbl)

        games = BoxLayout(size_hint_y=None, height=dp(92), spacing=dp(10))
        for label, screen, bg in (("Number game", "game_memory", "primary"),
                                  ("Which way?", "game_faces", "ok"),
                                  ("Color game", "game_colors", "warn")):
            games.add_widget(BigButton(label, bg=bg, size=26, on_release=lambda b, n=screen: app.open_game(n)))
        root.add_widget(games)
        self.add_widget(root)

    def update(self, now, status, next_event):
        tz = status.get("timezone")
        local = to_local(now, tz)
        self.time_lbl.text = local.strftime("%H:%M")
        self.date_lbl.text = local.strftime("%A %d %B")
        if next_event:
            at = to_local(parse_ts(next_event["scheduled_at"]), tz)
            day = "" if at.date() == local.date() else at.strftime("%a ")
            self.next_lbl.text = f"{day}{at:%H:%M}   {next_event['title']}"
        else:
            self.next_lbl.text = "Nothing else scheduled"

        name = status.get("patient_name")
        conn = "Online" if status.get("online") else "Offline"
        self.conn_lbl.text = f"{name}  ·  {conn}" if name else conn
        self.conn_lbl.color = color("muted" if status.get("online") else "warn")

        notes = []
        if status.get("message"):
            notes.append(status["message"])
        if not status.get("online"):
            notes.append("No connection. I will keep reminding you and send answers later.")
        if status.get("outbox_pending") and status.get("online"):
            notes.append(f"Sending {status['outbox_pending']} item(s)...")
        if status.get("outbox_failed"):
            notes.append(f"{status['outbox_failed']} item(s) could not be sent - staff please check.")
        self.notice_lbl.text = "\n".join(notes[:2])


# ------------------------------------------------------------------------------------ pairing
class SetupScreen(KeyScreen):
    CODE_LEN = 6

    def __init__(self, app, **kw):
        super().__init__(name="setup", **kw)
        self.app = app
        self.code = ""
        self.busy = False
        root = BoxLayout(orientation="horizontal", padding=dp(16), spacing=dp(16))

        left = BoxLayout(orientation="vertical", spacing=dp(8))
        left.add_widget(Text("Set up P-kun", 34, bold=True, size_hint_y=None, height=dp(50)))
        self.info = Text("Enter the 6-digit code shown on the caretaker dashboard (Devices page).", 20,
                         fg="muted", size_hint_y=None, height=dp(80))
        left.add_widget(self.info)
        self.code_lbl = Text("", 60, bold=True, size_hint_y=None, height=dp(90))
        left.add_widget(self.code_lbl)
        self.msg = Text("", 22, fg="warn")
        left.add_widget(self.msg)
        root.add_widget(left)

        pad = GridLayout(cols=3, spacing=dp(8), size_hint_x=0.9)
        for label in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Del", "0", "OK"]:
            bg = "neutral" if label == "Del" else ("ok" if label == "OK" else "card")
            pad.add_widget(BigButton(label, bg=bg, size=30, on_release=lambda b, l=label: self.press(l)))
        root.add_widget(pad)
        self.add_widget(root)
        self._render()

    def set_status(self, status):
        state = status.get("state")
        if state == "revoked":
            self.info.text = ("This P-kun was removed. A removed P-kun needs a new device account "
                              "before it can be paired again.")
        elif state == "auth_failed":
            self.info.text = status.get("message") or "Cannot sign in."
        else:
            self.info.text = "Enter the 6-digit code shown on the caretaker dashboard (Devices page)."

    def press(self, label):
        if self.busy:
            return
        if label == "Del":
            self.code = self.code[:-1]
        elif label == "OK":
            if len(self.code) == self.CODE_LEN:
                self.busy = True
                self.msg.text = "Pairing..."
                self.msg.color = color("muted")
                self.app.engine.pair(self.code, self._done_bg)
            else:
                self.msg.text = "The code has 6 digits."
        elif len(self.code) < self.CODE_LEN:
            self.code += label
            self.msg.text = ""
        self._render()

    def _done_bg(self, ok, message):
        Clock.schedule_once(lambda dt: self._done(ok, message))

    def _done(self, ok, message):
        self.busy = False
        self.msg.text = message
        self.msg.color = color("ok" if ok else "warn")
        if not ok:
            self.code = ""
            self._render()

    def _render(self):
        self.code_lbl.text = " ".join(self.code.ljust(self.CODE_LEN, "_"))

    def on_key(self, key, codepoint):
        d = key_digit(key, codepoint)
        if d is not None:
            self.press(str(d))
        elif key == 8:
            self.press("Del")
        elif key in (13, 271):
            self.press("OK")
        else:
            return False
        return True


# ------------------------------------------------------------------------------------ contact
class ContactScreen(Screen):
    def __init__(self, app, **kw):
        super().__init__(name="contact", **kw)
        self.app = app
        root = BoxLayout(orientation="vertical", padding=dp(16), spacing=dp(12))
        head = BoxLayout(size_hint_y=None, height=dp(60), spacing=dp(12))
        head.add_widget(Text("Contact caretaker", 32, bold=True, halign="left"))
        head.add_widget(BigButton("Back", bg="neutral", size=24, size_hint_x=None, width=dp(140),
                                  on_release=lambda *_: app.go("home")))
        root.add_widget(head)
        self.body = BoxLayout(orientation="vertical", spacing=dp(12))
        root.add_widget(self.body)
        self.add_widget(root)
        self._timer = None

    def on_pre_enter(self, *_):
        self._show_choices()

    def on_leave(self, *_):
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def _show_choices(self):
        self.body.clear_widgets()
        for code, label, bg in REQUESTS:
            self.body.add_widget(BigButton(label, bg=bg, size=32, on_release=lambda b, c=code: self._send(c)))

    def _send(self, code):
        ok = self.app.engine.send_request(code)
        self.app.robot.signal("request", code=code)
        self.body.clear_widgets()
        if not ok:
            text, fg = "P-kun is not connected to a patient yet. Please ask staff for help.", "warn"
        elif self.app.engine.online:
            text, fg = "Sent! Your caretaker has been told.", "ok"
        else:
            text, fg = "Saved. I will send it as soon as I am online.\nIf it is urgent, please call out for staff.", "warn"
        self.body.add_widget(Text(text, 34, fg=fg, bold=True))
        self._timer = Clock.schedule_once(lambda dt: self.app.go("home"), 5)


# ------------------------------------------------------------------------------------ prompt
class PromptScreen(Screen):
    """Shows one notification (event or caregiver message) at a time."""

    def __init__(self, app, **kw):
        super().__init__(name="prompt", **kw)
        self.app = app
        self.root_box = BoxLayout(orientation="vertical", padding=dp(16), spacing=dp(10))
        self.add_widget(self.root_box)
        self._events = []

    def _cancel(self):
        for ev in self._events:
            ev.cancel()
        self._events = []
        Animation.cancel_all(self.root_box)
        self.root_box.opacity = 1

    def show(self, item, on_choice, on_timeout):
        self._cancel()
        box = self.root_box
        box.clear_widgets()
        head = Card(bg=item.color, size_hint_y=None, height=dp(56))
        head.add_widget(Text(item.header, 26, bold=True))
        box.add_widget(head)
        box.add_widget(Text(item.title, 40, bold=True, size_hint_y=0.9))
        for line in item.lines:
            box.add_widget(Text(line, 26, fg="muted", size_hint_y=0.45))
        if item.question:
            box.add_widget(Text(item.question, 30, bold=True, size_hint_y=0.5))
        if item.options:
            cols = min(len(item.options), 3)
            rows = (len(item.options) + cols - 1) // cols
            grid = GridLayout(cols=cols, spacing=dp(12), size_hint_y=None, height=dp(96) * rows + dp(12) * (rows - 1))
            for label, value, bg in item.options:
                grid.add_widget(BigButton(label, bg=bg, size=34, on_release=lambda b, v=value: on_choice(v)))
            box.add_widget(grid)
        if item.timeout:
            bar = ProgressBar(max=item.timeout, value=item.timeout, size_hint_y=None, height=dp(20))
            box.add_widget(bar)
            step = 0.1

            def tick(dt):
                bar.value = max(0, bar.value - step)
            self._events.append(Clock.schedule_interval(tick, step))

            def fade(dt):
                anim = Animation(opacity=0, d=1.0)
                anim.bind(on_complete=lambda *_: (self._cancel(), on_timeout()))
                anim.start(box)
            self._events.append(Clock.schedule_once(fade, item.timeout))
        else:
            box.add_widget(Widget(size_hint_y=0.1))

    def show_thanks(self, text, then, seconds=2.0):
        self._cancel()
        self.root_box.clear_widgets()
        self.root_box.add_widget(Text(text, 44, bold=True, fg="ok"))
        self._events.append(Clock.schedule_once(lambda dt: then(), seconds))

    def on_leave(self, *_):
        self._cancel()
