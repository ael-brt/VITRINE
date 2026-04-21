import os
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key:
            continue

        # Keep explicit environment values as highest priority.
        os.environ.setdefault(key, value)


_BASE_DIR = Path(__file__).resolve().parents[2]
_load_env_file(_BASE_DIR / ".env")
_load_env_file(_BASE_DIR / ".env.local")

_env = os.getenv("DJANGO_ENV", "local").lower()

if _env == "prod":
    from .prod import *  # noqa: F401,F403
else:
    from .local import *  # noqa: F401,F403
