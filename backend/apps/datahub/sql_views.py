from __future__ import annotations

from django.db import connection
from django.utils import timezone

from .models import SqlView


class SqlViewError(RuntimeError):
    pass


def _validate_select_sql(sql: str) -> str:
    normalized = (sql or "").strip()
    lower = normalized.lower()
    if not lower.startswith("select"):
        raise SqlViewError("Only SELECT queries are allowed.")
    banned = (";", "--", "/*", "*/", "insert ", "update ", "delete ", "drop ", "alter ", "create ", "grant ", "revoke ", "truncate ")
    if any(token in lower for token in banned):
        raise SqlViewError("Forbidden token in SQL query.")
    return normalized


def _relation_name(view: SqlView) -> str:
    return (view.db_relation_name or f"dh_view_{view.slug.replace('-', '_')}")[:150]


def deploy_sql_view(view: SqlView) -> str:
    query = _validate_select_sql(view.sql_query)
    relation = _relation_name(view)
    qrel = connection.ops.quote_name(relation)
    with connection.cursor() as cursor:
        cursor.execute(f"DROP MATERIALIZED VIEW IF EXISTS {qrel}")
        cursor.execute(f"DROP VIEW IF EXISTS {qrel}")
        if view.storage_mode == SqlView.StorageMode.MATERIALIZED_VIEW:
            cursor.execute(f"CREATE MATERIALIZED VIEW {qrel} AS {query}")
        else:
            cursor.execute(f"CREATE OR REPLACE VIEW {qrel} AS {query}")
    view.db_relation_name = relation
    view.last_refresh_status = "ready"
    view.last_refresh_error = ""
    view.save(update_fields=["db_relation_name", "last_refresh_status", "last_refresh_error"])
    return relation


def refresh_materialized_view(view: SqlView) -> None:
    if view.storage_mode != SqlView.StorageMode.MATERIALIZED_VIEW:
        raise SqlViewError("Refresh only valid for materialized views.")
    relation = _relation_name(view)
    qrel = connection.ops.quote_name(relation)
    with connection.cursor() as cursor:
        cursor.execute(f"REFRESH MATERIALIZED VIEW {qrel}")
    view.last_refresh_at = timezone.now()
    view.last_refresh_status = "success"
    view.last_refresh_error = ""
    view.save(update_fields=["last_refresh_at", "last_refresh_status", "last_refresh_error"])

