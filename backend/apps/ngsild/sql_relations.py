from __future__ import annotations

from typing import Any

from django.db import connection
from django.utils import timezone

from .models import DashboardNgsiLdSqlRelation


class SqlRelationError(RuntimeError):
    pass


def _validate_sql_query(sql: str) -> str:
    normalized = (sql or "").strip()
    if not normalized:
        raise SqlRelationError("SQL query is required.")
    lowered = normalized.lower()
    if not lowered.startswith("select"):
        raise SqlRelationError("Only SELECT queries are allowed.")
    if ";" in normalized:
        raise SqlRelationError("Semicolons are not allowed in SQL query.")
    banned = ("insert ", "update ", "delete ", "drop ", "alter ", "create ", "grant ", "revoke ", "truncate ")
    if any(token in lowered for token in banned):
        raise SqlRelationError("Only read-only SELECT queries are allowed.")
    return normalized


def _relation_name(relation: DashboardNgsiLdSqlRelation) -> str:
    if relation.db_relation_name:
        return relation.db_relation_name
    return f"ngsild_rel_{relation.dashboard_id}_{relation.slug}".replace("-", "_")


def deploy_sql_relation(relation: DashboardNgsiLdSqlRelation) -> str:
    sql_query = _validate_sql_query(relation.sql_query)
    relation_name = _relation_name(relation)
    quoted_relation = connection.ops.quote_name(relation_name)

    with connection.cursor() as cursor:
        cursor.execute(f"DROP MATERIALIZED VIEW IF EXISTS {quoted_relation}")
        cursor.execute(f"DROP VIEW IF EXISTS {quoted_relation}")
        if relation.storage_mode == DashboardNgsiLdSqlRelation.StorageMode.MATERIALIZED_VIEW:
            cursor.execute(f"CREATE MATERIALIZED VIEW {quoted_relation} AS {sql_query}")
        else:
            cursor.execute(f"CREATE OR REPLACE VIEW {quoted_relation} AS {sql_query}")

    relation.db_relation_name = relation_name
    relation.last_refresh_status = "ready"
    relation.last_refresh_error = ""
    relation.save(update_fields=["db_relation_name", "last_refresh_status", "last_refresh_error"])
    return relation_name


def refresh_sql_relation(relation: DashboardNgsiLdSqlRelation) -> None:
    if relation.storage_mode != DashboardNgsiLdSqlRelation.StorageMode.MATERIALIZED_VIEW:
        raise SqlRelationError("Manual refresh is available only for materialized views.")
    relation_name = relation.db_relation_name or deploy_sql_relation(relation)
    quoted_relation = connection.ops.quote_name(relation_name)
    with connection.cursor() as cursor:
        cursor.execute(f"REFRESH MATERIALIZED VIEW {quoted_relation}")
    relation.last_refreshed_at = timezone.now()
    relation.last_refresh_status = "success"
    relation.last_refresh_error = ""
    relation.save(update_fields=["last_refreshed_at", "last_refresh_status", "last_refresh_error"])


def fetch_sql_relation_data(
    relation: DashboardNgsiLdSqlRelation,
    *,
    page: int = 1,
    page_size: int = 200,
) -> dict[str, Any]:
    relation_name = relation.db_relation_name or deploy_sql_relation(relation)
    quoted_relation = connection.ops.quote_name(relation_name)
    safe_page = max(1, int(page))
    safe_page_size = max(1, min(int(page_size), 1000))
    offset = (safe_page - 1) * safe_page_size

    with connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM {quoted_relation}")
        total_rows = int(cursor.fetchone()[0] or 0)
        cursor.execute(f"SELECT * FROM {quoted_relation} LIMIT %s OFFSET %s", [safe_page_size, offset])
        columns = [desc[0] for desc in (cursor.description or [])]
        rows = cursor.fetchall()

    items = [dict(zip(columns, row)) for row in rows]
    return {
        "dashboard_slug": relation.dashboard.slug,
        "relation_slug": relation.slug,
        "relation_name": relation.name,
        "storage_mode": relation.storage_mode,
        "generated_at": timezone.now().isoformat(),
        "page": safe_page,
        "page_size": safe_page_size,
        "total_rows": total_rows,
        "total_items": len(items),
        "columns": columns,
        "items": items,
        "endpoint": f"/api/v1/dashboards/{relation.dashboard.slug}/relations/{relation.slug}/data/",
    }


def fetch_sql_relation_kpis(relation: DashboardNgsiLdSqlRelation) -> dict[str, Any]:
    relation_name = relation.db_relation_name or deploy_sql_relation(relation)
    quoted_relation = connection.ops.quote_name(relation_name)

    with connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM {quoted_relation}")
        row_count = int(cursor.fetchone()[0] or 0)
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            [relation_name],
        )
        columns = [row[0] for row in cursor.fetchall()]

    extra: dict[str, Any] = {}
    if "matched" in columns:
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {quoted_relation} WHERE matched = TRUE")
            extra["matched_true_count"] = int(cursor.fetchone()[0] or 0)
            cursor.execute(f"SELECT COUNT(*) FROM {quoted_relation} WHERE matched = FALSE")
            extra["matched_false_count"] = int(cursor.fetchone()[0] or 0)

    for candidate in ("entity_id", "left_entity_id", "right_entity_id"):
        if candidate in columns:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT COUNT(DISTINCT {connection.ops.quote_name(candidate)}) FROM {quoted_relation}"
                )
                extra[f"distinct_{candidate}"] = int(cursor.fetchone()[0] or 0)

    return {
        "dashboard_slug": relation.dashboard.slug,
        "relation_slug": relation.slug,
        "relation_name": relation.name,
        "storage_mode": relation.storage_mode,
        "db_relation_name": relation_name,
        "row_count": row_count,
        "column_count": len(columns),
        "columns": columns,
        "last_refreshed_at": relation.last_refreshed_at.isoformat() if relation.last_refreshed_at else None,
        "last_refresh_status": relation.last_refresh_status or "",
        "last_refresh_error": relation.last_refresh_error or "",
        "endpoint_data": f"/api/v1/dashboards/{relation.dashboard.slug}/relations/{relation.slug}/data/",
        "endpoint_kpis": f"/api/v1/dashboards/{relation.dashboard.slug}/relations/{relation.slug}/kpis/",
        **extra,
    }
