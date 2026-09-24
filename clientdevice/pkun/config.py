"""Configuration from environment variables or a .env file in the app folder."""
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_VERSION = "0.1.0"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Config:
    supabase_url: str
    publishable_key: str
    email: str | None          # optional: only for a Pi that uses a dedicated email account
    password: str | None
    device_name: str
    data_dir: Path
    fullscreen: bool
    font: str | None
    app_version: str = APP_VERSION


def load_config() -> Config:
    _load_env_file(ROOT / ".env")
    required = ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY")
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"Missing settings: {', '.join(missing)}. Copy .env.example to .env and fill it in.")
    data_dir = Path(os.environ.get("PKUN_DATA_DIR") or ROOT / "data")
    data_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(data_dir, 0o700)   # holds the device's session token
    except OSError:
        pass
    font = os.environ.get("PKUN_FONT") or None
    return Config(
        supabase_url=os.environ["SUPABASE_URL"].rstrip("/"),
        publishable_key=os.environ["SUPABASE_PUBLISHABLE_KEY"],
        email=os.environ.get("PKUN_EMAIL") or None,
        password=os.environ.get("PKUN_PASSWORD") or None,
        device_name=os.environ.get("PKUN_DEVICE_NAME", "P-kun").strip() or "P-kun",
        data_dir=data_dir,
        fullscreen=_flag("PKUN_FULLSCREEN"),
        font=font if font and Path(font).exists() else None,
    )
