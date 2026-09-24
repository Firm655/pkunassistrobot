"""Time helpers. Everything is stored and compared in UTC; only the screen uses local time."""
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

DEFAULT_TZ = "Asia/Bangkok"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    """Fixed-format UTC string, so timestamps sort and compare correctly as text in SQLite."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def norm(value: str) -> str:
    return iso(parse_ts(value))


def to_local(dt: datetime, tz_name: str | None) -> datetime:
    if ZoneInfo is None:
        return dt
    try:
        return dt.astimezone(ZoneInfo(tz_name or DEFAULT_TZ))
    except Exception:
        return dt.astimezone()
