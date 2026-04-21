import os
from datetime import datetime, timezone
from typing import Any

from django.core.cache import cache

from .client import NgsiLdClientError, fetch_entities
from .models import DashboardNgsiLdSource


DASHBOARD_ENTITY_TYPES = {
    "floatingcardata": ["TronconDeRoute"],
    "secteurscolaire": ["SecteurScolaire"],
}


def _extract_geometry(entity: dict[str, Any]) -> dict[str, Any] | None:
    localisation = entity.get("localisation")
    if not isinstance(localisation, dict):
        return None
    if localisation.get("type") != "GeoProperty":
        return None
    value = localisation.get("value")
    return value if isinstance(value, dict) else None


def _build_stats(entities: list[dict[str, Any]]) -> dict[str, int]:
    line_count = 0
    point_count = 0
    unknown_count = 0

    for entity in entities:
        geometry = _extract_geometry(entity)
        gtype = geometry.get("type") if geometry else None
        if gtype == "Point":
            point_count += 1
        elif gtype in {"LineString", "MultiLineString"}:
            line_count += 1
        else:
            unknown_count += 1

    return {
        "line_count": line_count,
        "point_count": point_count,
        "unknown_geometry_count": unknown_count,
    }


def _cache_ttl_seconds() -> int:
    value = os.getenv("NGSILD_CACHE_TTL_SECONDS", "60")
    try:
        return max(5, int(value))
    except Exception:
        return 60


def _resolve_source(slug: str) -> DashboardNgsiLdSource | None:
    try:
        return (
            DashboardNgsiLdSource.objects.select_related("dashboard")
            .prefetch_related("entity_types")
            .filter(dashboard__slug=slug, is_active=True)
            .first()
        )
    except Exception:
        return None


def _build_overrides(source: DashboardNgsiLdSource | None) -> dict[str, str | int | None]:
    if not source:
        return {}

    return {
        "tenant": source.tenant or None,
        "tenant_header": source.tenant_header or None,
        "context_link": source.context_link or None,
        "base_url": source.base_url or None,
        "auth_url": source.auth_url or None,
        "client_id": source.client_id or None,
        "oauth_scope": source.oauth_scope or None,
        "oauth_audience": source.oauth_audience or None,
    }


def _resolve_entity_types(source: DashboardNgsiLdSource | None, slug: str) -> list[str]:
    if source:
        configured = [
            item.entity_type
            for item in source.entity_types.filter(is_active=True)
            if item.entity_type
        ]
        if configured:
            return configured
        if source.entity_type:
            return [source.entity_type]

    fallback = DASHBOARD_ENTITY_TYPES.get(slug, [])
    return [item for item in fallback if item]


def build_source_overrides(source: DashboardNgsiLdSource | None) -> dict[str, str | int | None]:
    return _build_overrides(source)


def resolve_source_entity_types(source: DashboardNgsiLdSource | None, slug: str) -> list[str]:
    return _resolve_entity_types(source, slug)


def get_dashboard_data(slug: str) -> dict[str, Any]:
    source = _resolve_source(slug)
    entity_types = _resolve_entity_types(source, slug)
    if not entity_types:
        return {
            "dashboard_slug": slug,
            "entity_type": None,
            "entity_types": [],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "items": [],
            "stats": {"line_count": 0, "point_count": 0, "unknown_geometry_count": 0},
            "total_entities": 0,
            "sample_ids": [],
            "warning": "No NGSI-LD source configured for this dashboard.",
        }

    cache_key = f"ngsild:dashboard:{slug}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    request_limit = source.request_limit if source else 100
    entities: list[dict[str, Any]] = []
    counts_by_type: dict[str, int] = {}

    for entity_type in entity_types:
        typed_entities = fetch_entities(
            entity_type=entity_type,
            limit=request_limit,
            overrides=_build_overrides(source),
        )
        counts_by_type[entity_type] = len(typed_entities)
        entities.extend(typed_entities)

    stats = _build_stats(entities)

    response = {
        "dashboard_slug": slug,
        "entity_type": entity_types[0],
        "entity_types": entity_types,
        "counts_by_type": counts_by_type,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_entities": len(entities),
        "stats": stats,
        "sample_ids": [entity.get("id") for entity in entities[:10] if isinstance(entity.get("id"), str)],
        "items": entities[:200],
        "tenant": source.tenant if source else os.getenv("NGSILD_TENANT", ""),
    }

    ttl = source.cache_ttl_seconds if source else _cache_ttl_seconds()
    cache.set(cache_key, response, timeout=max(5, ttl))
    return response


def safe_get_dashboard_data(slug: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return get_dashboard_data(slug), None
    except NgsiLdClientError as exc:
        return None, str(exc)
