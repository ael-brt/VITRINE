
try:
    from .celery import app as celery_app
except Exception:  # pragma: no cover - fallback when celery deps are not installed yet
    celery_app = None

__all__ = ("celery_app",)
