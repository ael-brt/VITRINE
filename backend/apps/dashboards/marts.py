from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.core.cache import cache
from django.db.models import Count, Max
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.ngsild.models import DashboardNgsiLdNormalizedEntity, DashboardNgsiLdSource


def _extract_geometry(payload: dict[str, Any]) -> dict[str, Any] | None:
    localisation = payload.get("localisation")
    if not isinstance(localisation, dict):
        return None
    if localisation.get("type") != "GeoProperty":
        return None
    value = localisation.get("value")
    if isinstance(value, dict) and isinstance(value.get("type"), str):
        return value
    return None


def _cache_ttl_seconds(dashboard_slug: str) -> int:
    source = (
        DashboardNgsiLdSource.objects.filter(dashboard__slug=dashboard_slug, is_active=True)
        .only("cache_ttl_seconds")
        .first()
    )
    if source and source.cache_ttl_seconds:
        return max(5, source.cache_ttl_seconds)
    return 60


def _cache_key(prefix: str, dashboard_slug: str, **parts: Any) -> str:
    serialized = "|".join(f"{k}={parts[k]}" for k in sorted(parts))
    return f"marts:{prefix}:{dashboard_slug}:{serialized}"


def map_mart(
    *,
    dashboard_slug: str,
    entity_type: str | None = None,
    tenant: str | None = None,
    join_key: str | None = None,
    page: int = 1,
    page_size: int = 200,
) -> dict[str, Any]:
    safe_page = max(1, int(page))
    safe_page_size = max(1, min(int(page_size), 1000))
    offset = (safe_page - 1) * safe_page_size

    cache_key = _cache_key(
        "map",
        dashboard_slug,
        entity_type=entity_type or "",
        tenant=tenant or "",
        join_key=join_key or "",
        page=safe_page,
        page_size=safe_page_size,
    )
    cached = cache.get(cache_key)
    if cached:
        return cached

    qs = DashboardNgsiLdNormalizedEntity.objects.filter(dashboard_slug=dashboard_slug).order_by("entity_type", "entity_id")
    if entity_type:
        qs = qs.filter(entity_type=entity_type)
    if tenant:
        qs = qs.filter(tenant=tenant)
    if join_key:
        qs = qs.filter(join_key=join_key)

    total_rows = qs.count()
    rows = list(qs[offset : offset + safe_page_size])
    items: list[dict[str, Any]] = []
    for row in rows:
        items.append(
            {
                "id": row.entity_id,
                "type": row.entity_type,
                "tenant": row.tenant,
                "join_key": row.join_key,
                "scope": row.scope,
                "geometry": _extract_geometry(row.entity_payload),
            }
        )

    payload = {
        "dashboard_slug": dashboard_slug,
        "entity_type": entity_type,
        "tenant": tenant,
        "join_key": join_key,
        "generated_at": timezone.now().isoformat(),
        "page": safe_page,
        "page_size": safe_page_size,
        "total_rows": total_rows,
        "total_items": len(items),
        "items": items,
    }
    cache.set(cache_key, payload, timeout=_cache_ttl_seconds(dashboard_slug))
    return payload


def kpis_mart(*, dashboard_slug: str, entity_type: str | None = None, tenant: str | None = None) -> dict[str, Any]:
    cache_key = _cache_key(
        "kpis",
        dashboard_slug,
        entity_type=entity_type or "",
        tenant=tenant or "",
    )
    cached = cache.get(cache_key)
    if cached:
        return cached

    qs = DashboardNgsiLdNormalizedEntity.objects.filter(dashboard_slug=dashboard_slug)
    if entity_type:
        qs = qs.filter(entity_type=entity_type)
    if tenant:
        qs = qs.filter(tenant=tenant)

    total = qs.count()
    by_type = list(qs.values("entity_type").annotate(count=Count("id")).order_by("entity_type"))
    with_join_key = qs.exclude(join_key="").count()
    with_tenant = qs.exclude(tenant="").count()
    with_timestamp = qs.exclude(ngsi_updated_at__isnull=True).count()
    latest_update = qs.aggregate(latest=Max("ngsi_updated_at")).get("latest")

    payload = {
        "dashboard_slug": dashboard_slug,
        "entity_type": entity_type,
        "tenant": tenant,
        "generated_at": timezone.now().isoformat(),
        "total_entities": total,
        "counts_by_type": by_type,
        "with_join_key": with_join_key,
        "with_tenant": with_tenant,
        "with_ngsi_updated_at": with_timestamp,
        "latest_ngsi_updated_at": latest_update.isoformat() if latest_update else None,
    }
    cache.set(cache_key, payload, timeout=_cache_ttl_seconds(dashboard_slug))
    return payload


def timeseries_mart(
    *,
    dashboard_slug: str,
    entity_type: str | None = None,
    tenant: str | None = None,
    days: int = 30,
) -> dict[str, Any]:
    safe_days = max(1, min(int(days), 365))
    cache_key = _cache_key(
        "timeseries",
        dashboard_slug,
        entity_type=entity_type or "",
        tenant=tenant or "",
        days=safe_days,
    )
    cached = cache.get(cache_key)
    if cached:
        return cached

    start = timezone.now() - timedelta(days=safe_days)

    qs = DashboardNgsiLdNormalizedEntity.objects.filter(
        dashboard_slug=dashboard_slug,
        updated_at__gte=start,
    )
    if entity_type:
        qs = qs.filter(entity_type=entity_type)
    if tenant:
        qs = qs.filter(tenant=tenant)

    # Prefer NGSI timestamps when available; fallback to local update timestamp.
    daily = (
        qs.annotate(series_day=TruncDate("ngsi_updated_at"))
        .values("series_day")
        .annotate(count=Count("id"))
        .order_by("series_day")
    )

    points = []
    for row in daily:
        if row["series_day"] is None:
            continue
        points.append(
            {
                "day": row["series_day"].isoformat(),
                "count": row["count"],
            }
        )

    if not points:
        fallback_daily = (
            qs.annotate(series_day=TruncDate("updated_at"))
            .values("series_day")
            .annotate(count=Count("id"))
            .order_by("series_day")
        )
        for row in fallback_daily:
            if row["series_day"] is None:
                continue
            points.append(
                {
                    "day": row["series_day"].isoformat(),
                    "count": row["count"],
                }
            )

    payload = {
        "dashboard_slug": dashboard_slug,
        "entity_type": entity_type,
        "tenant": tenant,
        "days": safe_days,
        "generated_at": timezone.now().isoformat(),
        "points": points,
    }
    cache.set(cache_key, payload, timeout=_cache_ttl_seconds(dashboard_slug))
    return payload
