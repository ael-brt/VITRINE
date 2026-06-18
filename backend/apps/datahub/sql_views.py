from __future__ import annotations

import re

from django.conf import settings
from django.db import connection
from django.utils import timezone

from .models import EntityTable, SqlView


class SqlViewError(RuntimeError):
    pass


def _statement_timeout_ms() -> int:
    return int(getattr(settings, "DATAHUB_SQL_VIEW_STATEMENT_TIMEOUT_MS", 5000))


def _apply_statement_timeout(cursor) -> None:
    if connection.vendor == "postgresql":
        cursor.execute("SET LOCAL statement_timeout = %s", [_statement_timeout_ms()])


def allowed_relation_names() -> list[str]:
    relations = set(EntityTable.objects.values_list("table_name", flat=True))
    relations.update(SqlView.objects.exclude(db_relation_name="").values_list("db_relation_name", flat=True))
    return sorted(name for name in relations if name)


def _validate_select_sql(sql: str) -> str:
    normalized = (sql or "").strip()
    lower = normalized.lower()
    if not lower.startswith("select"):
        raise SqlViewError("Only SELECT queries are allowed.")
    banned = (
        ";",
        "--",
        "/*",
        "*/",
        "insert ",
        "update ",
        "delete ",
        "drop ",
        "alter ",
        "create ",
        "grant ",
        "revoke ",
        "truncate ",
        " execute ",
        " pg_sleep(",
    )
    if any(token in lower for token in banned):
        raise SqlViewError("Forbidden token in SQL query.")
    # Parse source relations from FROM/JOIN clauses and restrict to known DB relations.
    relations = re.findall(r"\b(?:from|join)\s+([a-zA-Z0-9_\.\"']+)", normalized, flags=re.IGNORECASE)
    allowed_relations = set(allowed_relation_names())
    for relation in relations:
        rel = relation.strip().strip('"').strip("'")
        rel = rel.split(".")[-1].strip('"')
        if rel.lower() in {"select"}:
            continue
        if rel not in allowed_relations:
            raise SqlViewError(
                f"Relation '{rel}' is not allowed. Use an existing DataHub table_name or deployed SQL view relation."
            )
    return normalized


def _relation_name(view: SqlView) -> str:
    return (view.db_relation_name or f"dh_view_{view.slug.replace('-', '_')}")[:150]


def _existing_relation_kind(cursor, relation: str) -> str | None:
    if connection.vendor == "postgresql":
        cursor.execute(
            """
            SELECT c.relkind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = %s
              AND n.nspname = current_schema()
            """,
            [relation],
        )
        row = cursor.fetchone()
        return row[0] if row else None
    return None


def _drop_relation_if_exists(cursor, relation: str) -> None:
    qrel = connection.ops.quote_name(relation)
    if connection.vendor == "postgresql":
        relkind = _existing_relation_kind(cursor, relation)
        if relkind == "m":
            cursor.execute(f"DROP MATERIALIZED VIEW {qrel}")
        elif relkind == "v":
            cursor.execute(f"DROP VIEW {qrel}")
        return
    cursor.execute(f"DROP VIEW IF EXISTS {qrel}")


def deploy_sql_view(view: SqlView) -> str:
    query = _validate_select_sql(view.sql_query)
    relation = _relation_name(view)
    qrel = connection.ops.quote_name(relation)
    try:
        with connection.cursor() as cursor:
            _apply_statement_timeout(cursor)
            _drop_relation_if_exists(cursor, relation)
            if view.storage_mode == SqlView.StorageMode.MATERIALIZED_VIEW:
                cursor.execute(f"CREATE MATERIALIZED VIEW {qrel} AS {query}")
            else:
                cursor.execute(f"CREATE VIEW {qrel} AS {query}")
        view.db_relation_name = relation
        view.last_refresh_status = "ready"
        view.last_refresh_error = ""
        view.save(update_fields=["db_relation_name", "last_refresh_status", "last_refresh_error"])
        return relation
    except Exception as exc:
        view.db_relation_name = relation
        view.last_refresh_status = "failed"
        view.last_refresh_error = str(exc)
        view.save(update_fields=["db_relation_name", "last_refresh_status", "last_refresh_error"])
        raise


def drop_sql_view_relation(view: SqlView) -> None:
    relation = view.db_relation_name
    if not relation:
        return
    with connection.cursor() as cursor:
        _apply_statement_timeout(cursor)
        _drop_relation_if_exists(cursor, relation)


def refresh_materialized_view(view: SqlView) -> None:
    if view.storage_mode != SqlView.StorageMode.MATERIALIZED_VIEW:
        raise SqlViewError("Refresh only valid for materialized views.")
    relation = _relation_name(view)
    qrel = connection.ops.quote_name(relation)
    with connection.cursor() as cursor:
        _apply_statement_timeout(cursor)
        cursor.execute(f"REFRESH MATERIALIZED VIEW {qrel}")
    view.last_refresh_at = timezone.now()
    view.last_refresh_status = "success"
    view.last_refresh_error = ""
    view.save(update_fields=["last_refresh_at", "last_refresh_status", "last_refresh_error"])


def execute_sql_sandbox_query(sql: str, *, row_limit: int) -> tuple[str, list[str], list[tuple]]:
    normalized = _validate_select_sql(sql)
    safe_row_limit = max(1, min(int(row_limit), 500))
    preview_sql = f"SELECT * FROM ({normalized}) AS datahub_sql_sandbox LIMIT %s"
    with connection.cursor() as cursor:
        _apply_statement_timeout(cursor)
        cursor.execute(preview_sql, [safe_row_limit])
        columns = [desc[0] for desc in (cursor.description or [])]
        rows = cursor.fetchall()
    return normalized, columns, rows
