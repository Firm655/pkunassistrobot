#!/usr/bin/env python3
"""P-kun patient device app (Raspberry Pi / VM / laptop).

    python3 main.py            start the app
    python3 main.py --reset    forget the local cache, outbox and pairing (keeps .env), then start
"""
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

os.environ.setdefault("KIVY_NO_ARGS", "1")   # our own flags, not Kivy's

from pkun.config import load_config  # noqa: E402


def setup_logging(data_dir):
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger("pkun")
    root.setLevel(logging.INFO)
    fh = RotatingFileHandler(data_dir / "pkun.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    root.addHandler(fh)
    root.addHandler(sh)


def configure_kivy(cfg):
    from kivy.config import Config as KivyConfig
    KivyConfig.set("graphics", "width", "800")     # official 7" Pi touchscreen
    KivyConfig.set("graphics", "height", "480")
    KivyConfig.set("input", "mouse", "mouse,multitouch_on_demand")
    if cfg.fullscreen:
        KivyConfig.set("graphics", "fullscreen", "auto")
        KivyConfig.set("graphics", "show_cursor", "0")
        KivyConfig.set("kivy", "exit_on_escape", "0")
    if cfg.font:
        from kivy.core.text import DEFAULT_FONT, LabelBase
        LabelBase.register(DEFAULT_FONT, cfg.font)


def main():
    cfg = load_config()
    if "--reset" in sys.argv:
        for name in ("pkun.db", "pkun.db-wal", "pkun.db-shm"):
            path = cfg.data_dir / name
            if path.exists():
                path.unlink()
        print("Local cache, outbox and pairing cleared. Revoke this P-kun on the dashboard; it will ask for a new code.")
    setup_logging(cfg.data_dir)
    configure_kivy(cfg)
    from pkun.ui.app import PkunApp
    PkunApp(cfg).run()


if __name__ == "__main__":
    main()
