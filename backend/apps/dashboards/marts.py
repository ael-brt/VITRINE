from __future__ import annotations

from apps.datahub.service import fetch_binding_kpis, fetch_binding_map, resolve_dashboard_binding_for_user


def map_mart(*, dashboard_slug: str, user, page: int = 1, page_size: int = 200):
    binding = resolve_dashboard_binding_for_user(dashboard_slug=dashboard_slug, user=user)
    if not binding:
        return {"dashboard_slug": dashboard_slug, "total_rows": 0, "items": []}
    return fetch_binding_map(binding=binding, page=page, page_size=page_size)


def kpis_mart(*, dashboard_slug: str, user):
    binding = resolve_dashboard_binding_for_user(dashboard_slug=dashboard_slug, user=user)
    if not binding:
        return {"dashboard_slug": dashboard_slug, "total_rows": 0}
    return fetch_binding_kpis(binding=binding)

