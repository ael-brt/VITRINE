from __future__ import annotations

from typing import Any

from django.db import connection

from .models import DashboardDataset, EntityTable, SqlView
from .security import user_environment_ids


def _q(name: str) -> str:
    return connection.ops.quote_name(name)


def _fetch_rows(sql: str, params: list[Any]) -> tuple[list[str], list[tuple]]:
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [desc[0] for desc in (cursor.description or [])]
        rows = cursor.fetchall()
    return columns, rows


def resolve_dashboard_binding_for_user(*, dashboard_slug: str, user) -> DashboardDataset | None:
    binding = (
        DashboardDataset.objects.select_related("environment", "entity_table", "sql_view", "dashboard")
        .filter(dashboard__slug=dashboard_slug, is_active=True)
        .first()
    )
    if not binding:
        return None
    allowed = user_environment_ids(user)
    if binding.environment_id not in allowed:
        return None
    return binding


def fetch_binding_map(*, binding: DashboardDataset, page: int, page_size: int) -> dict[str, Any]:
    safe_page = max(1, int(page))
    safe_size = max(1, min(int(page_size), 1000))
    offset = (safe_page - 1) * safe_size

    if binding.sql_view_id:
        relation = binding.sql_view.db_relation_name
    else:
        relation = binding.entity_table.table_name if binding.entity_table else ""
    if not relation:
        return {"total_rows": 0, "items": []}

    cols, count_rows = _fetch_rows(f"SELECT COUNT(*) AS c FROM {_q(relation)}", [])
    _ = cols
    total_rows = int(count_rows[0][0] if count_rows else 0)
    columns, rows = _fetch_rows(f"SELECT * FROM {_q(relation)} LIMIT %s OFFSET %s", [safe_size, offset])
    items = [dict(zip(columns, row)) for row in rows]
    return {
        "environment": binding.environment.slug,
        "source_kind": "sql_view" if binding.sql_view_id else "entity_table",
        "source": relation,
        "page": safe_page,
        "page_size": safe_size,
        "total_rows": total_rows,
        "total_items": len(items),
        "items": items,
    }


def fetch_binding_kpis(*, binding: DashboardDataset) -> dict[str, Any]:
    relation = binding.sql_view.db_relation_name if binding.sql_view_id else (binding.entity_table.table_name if binding.entity_table else "")
    if not relation:
        return {"total_rows": 0}
    _cols, rows = _fetch_rows(f"SELECT COUNT(*) AS c FROM {_q(relation)}", [])
    return {
        "environment": binding.environment.slug,
        "source_kind": "sql_view" if binding.sql_view_id else "entity_table",
        "source": relation,
        "total_rows": int(rows[0][0] if rows else 0),
    }

