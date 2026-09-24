"""Decides what P-kun must show right now. Pure logic (no Kivy) so it can be unit tested.

Anything returned by pending_items() is a *notification*: it interrupts whatever the patient is doing,
including the game. Caregiver messages come first, then due events in schedule order.
"""
from dataclasses import dataclass, field

from .store import OPEN_STATUSES
from .timeutil import iso, parse_ts

TASK_SECONDS = 15
MEAL_NAMES = {"BREAKFAST": "Breakfast", "LUNCH": "Lunch", "DINNER": "Dinner", "SNACK": "Snack"}


@dataclass
class Item:
    key: str                 # "event:<id>" or "message:<id>"
    kind: str                # MESSAGE | MEDICINE | MEAL | DAILY_CHECK_IN | TASK
    ref_id: str
    header: str
    color: str               # theme colour name
    title: str
    lines: list = field(default_factory=list)
    question: str | None = None
    options: list = field(default_factory=list)   # [(label, value, colour name)]
    timeout: float | None = None                   # auto-close (tasks)
    answered: bool = False


def event_item(ev: dict) -> Item:
    t, p = ev["event_type"], ev.get("payload") or {}
    desc = (ev.get("description") or "").strip()
    if t == "MEDICINE":
        lines = [x for x in (f"Dosage: {p['dosage']}" if p.get("dosage") else "",
                             p.get("instructions") or desc) if x]
        return Item(f"event:{ev['id']}", t, ev["id"], "Medicine time", "primary", p.get("name") or ev["title"],
                    lines, "Have you taken your medicine?",
                    [("Yes", "YES", "ok"), ("No", "NO", "danger")])
    if t == "MEAL":
        meal = MEAL_NAMES.get(p.get("meal_type"), ev["title"].title())
        return Item(f"event:{ev['id']}", t, ev["id"], "Meal time", "warn", meal, [desc] if desc else [],
                    "Have you eaten yet?", [("Yes", "YES", "ok"), ("No", "NO", "danger")])
    if t == "DAILY_CHECK_IN":
        answers = [str(a) for a in p.get("answers") or []]
        concerning = set(map(str, p.get("concerning_answers") or []))
        opts = [(a, a, "neutral" if a in concerning else "primary") for a in answers]
        return Item(f"event:{ev['id']}", t, ev["id"], "Daily check-in", "ok", ev["title"],
                    [desc] if desc else [], None, opts)
    # TASK: shown for 15 seconds, no answer needed
    return Item(f"event:{ev['id']}", "TASK", ev["id"], "Reminder", "neutral", ev["title"],
                [desc] if desc else [], None, [], timeout=TASK_SECONDS)


def message_item(msg: dict) -> Item:
    return Item(f"message:{msg['id']}", "MESSAGE", msg["id"], "Message from your caretaker", "primary",
                msg["message"], [], None, [("OK", "OK", "ok")])


def pending_items(store, now) -> list:
    now_iso = iso(now)
    items = [message_item(m) for m in store.unread_messages()]
    items += [event_item(e) for e in store.due_events(now_iso)]
    return items


def still_valid(store, item: Item, now) -> bool:
    """False when the server or the clock has taken the item away (skipped, answered elsewhere, overdue)."""
    if item.answered:
        return True
    if item.kind == "MESSAGE":
        m = store.message(item.ref_id)
        return m is not None and m["local_state"] is None
    ev = store.event(item.ref_id)
    if ev is None or ev["status"] not in OPEN_STATUSES or ev["local_state"] is not None:
        return False
    return parse_ts(ev["due_at"]) > now


def thank_you(item: Item, value: str) -> str:
    if item.kind in ("MEDICINE", "MEAL") and value == "NO":
        return "Okay. I will let your caretaker know."
    if item.kind == "MESSAGE":
        return "Okay!"
    return "Thank you!"
