from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.db import connection


@dataclass(frozen=True)
class ServiceHealth:
    name: str
    ok: bool
    detail: dict[str, Any]


def _check_database() -> ServiceHealth:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            row = cursor.fetchone()
        return ServiceHealth(
            name="database",
            ok=bool(row and row[0] == 1),
            detail={"engine": settings.DATABASES["default"]["ENGINE"]},
        )
    except Exception as exc:
        return ServiceHealth(
            name="database",
            ok=False,
            detail={
                "engine": settings.DATABASES["default"]["ENGINE"],
                "error": str(exc),
            },
        )


def _check_cache() -> ServiceHealth:
    cache_backend = settings.CACHES["default"]["BACKEND"]
    try:
        cache_key = "healthcheck:core:cache"
        cache.set(cache_key, "ok", timeout=5)
        value = cache.get(cache_key)
        return ServiceHealth(
            name="cache",
            ok=value == "ok",
            detail={"backend": cache_backend},
        )
    except Exception as exc:
        return ServiceHealth(
            name="cache",
            ok=False,
            detail={"backend": cache_backend, "error": str(exc)},
        )


def _check_celery() -> ServiceHealth:
    broker_url = getattr(settings, "CELERY_BROKER_URL", "")
    if not broker_url:
        return ServiceHealth(
            name="celery",
            ok=False,
            detail={"broker_url": "", "error": "CELERY_BROKER_URL not configured"},
        )

    try:
        from config.celery import app as celery_app

        with celery_app.connection_for_read() as conn:
            conn.ensure_connection(max_retries=0)
        return ServiceHealth(
            name="celery",
            ok=True,
            detail={"broker_url": broker_url},
        )
    except Exception as exc:
        return ServiceHealth(
            name="celery",
            ok=False,
            detail={"broker_url": broker_url, "error": str(exc)},
        )


def build_health_payload() -> dict[str, Any]:
    db = _check_database()
    cache_state = _check_cache()
    celery_state = _check_celery()

    overall_ok = db.ok and cache_state.ok
    status = "ok" if overall_ok else "degraded"

    return {
        "status": status,
        "services": {
            db.name: {"ok": db.ok, **db.detail},
            cache_state.name: {"ok": cache_state.ok, **cache_state.detail},
            celery_state.name: {"ok": celery_state.ok, **celery_state.detail},
        },
    }
