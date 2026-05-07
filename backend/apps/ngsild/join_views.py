from __future__ import annotations

from django.db import connection
from django.utils import timezone

from .models import DashboardNgsiLdJoinRule


class JoinViewError(RuntimeError):
    pass


def _column_field_name(path: str) -> str | None:
    if not path.startswith("column."):
        return None
    value = path[len("column.") :].strip()
    if not value:
        return None
    allowed = {"entity_id", "join_key", "tenant", "scope", "dashboard_slug", "source_id", "entity_type"}
    return value if value in allowed else None


def _relation_name(rule: DashboardNgsiLdJoinRule) -> str:
    if rule.db_relation_name:
        return rule.db_relation_name
    return f"ngsild_join_rule_{rule.id}"


def _build_join_sql(rule: DashboardNgsiLdJoinRule, *, materialized: bool) -> tuple[str, list]:
    left_column = _column_field_name(rule.left_key_path)
    right_column = _column_field_name(rule.right_key_path)
    if not left_column or not right_column:
        raise JoinViewError("Only column.* key paths are supported for database views.")

    relation_name = _relation_name(rule)
    quoted_relation = connection.ops.quote_name(relation_name)
    join_keyword = "LEFT JOIN" if rule.join_kind == DashboardNgsiLdJoinRule.JoinKind.LEFT else "INNER JOIN"
    create_stmt = "CREATE MATERIALIZED VIEW" if materialized else "CREATE OR REPLACE VIEW"
    where_right = "AND r.tenant = %s" if rule.right_tenant else ""
    where_left = "AND l.tenant = %s" if rule.left_tenant else ""
    params = [
        rule.id,
        rule.dashboard.slug,
        rule.name,
        rule.left_source_id,
        rule.left_entity_type,
    ]
    if rule.left_tenant:
        params.append(rule.left_tenant)
    params.extend([rule.right_source_id, rule.right_entity_type])
    if rule.right_tenant:
        params.append(rule.right_tenant)

    sql = f"""
{create_stmt} {quoted_relation} AS
SELECT
  %s::bigint AS join_rule_id,
  %s::text AS dashboard_slug,
  %s::text AS rule_name,
  l.id AS left_row_id,
  l.source_id AS left_source_id,
  l.entity_type AS left_entity_type,
  l.entity_id AS left_entity_id,
  l.tenant AS left_tenant,
  l.join_key AS left_join_key,
  l.scope AS left_scope,
  l.entity_payload AS left_payload,
  r.id AS right_row_id,
  r.source_id AS right_source_id,
  r.entity_type AS right_entity_type,
  r.entity_id AS right_entity_id,
  r.tenant AS right_tenant,
  r.join_key AS right_join_key,
  r.scope AS right_scope,
  r.entity_payload AS right_payload,
  (r.id IS NOT NULL) AS matched
FROM apps_ngsild_dashboardngsildnormalizedentity l
{join_keyword} apps_ngsild_dashboardngsildnormalizedentity r
  ON l.{left_column} = r.{right_column}
  AND r.source_id = %s
  AND r.entity_type = %s
  {where_right}
WHERE l.source_id = %s
  AND l.entity_type = %s
  {where_left}
"""
    # reorder params to match sql placeholders order
    final_params: list = [rule.id, rule.dashboard.slug, rule.name, rule.right_source_id, rule.right_entity_type]
    if rule.right_tenant:
        final_params.append(rule.right_tenant)
    final_params.extend([rule.left_source_id, rule.left_entity_type])
    if rule.left_tenant:
        final_params.append(rule.left_tenant)
    return sql, final_params


def ensure_join_relation(rule: DashboardNgsiLdJoinRule) -> str:
    relation_name = _relation_name(rule)
    materialized = rule.storage_mode == DashboardNgsiLdJoinRule.StorageMode.MATERIALIZED_VIEW

    sql, params = _build_join_sql(rule, materialized=materialized)
    with connection.cursor() as cursor:
        # Always drop the opposite relation type to avoid name conflicts.
        quoted = connection.ops.quote_name(relation_name)
        cursor.execute(f"DROP MATERIALIZED VIEW IF EXISTS {quoted}")
        cursor.execute(f"DROP VIEW IF EXISTS {quoted}")
        cursor.execute(sql, params)
        if materialized:
            # Index to support CONCURRENTLY refresh.
            index_name = connection.ops.quote_name(f"{relation_name}_uniq_left_row")
            cursor.execute(
                f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {quoted} (left_row_id)"
            )

    if rule.db_relation_name != relation_name:
        rule.db_relation_name = relation_name
        rule.save(update_fields=["db_relation_name"])
    return relation_name


def refresh_join_relation(rule: DashboardNgsiLdJoinRule) -> None:
    if rule.storage_mode != DashboardNgsiLdJoinRule.StorageMode.MATERIALIZED_VIEW:
        raise JoinViewError("Refresh is available only for materialized views.")

    relation_name = ensure_join_relation(rule)
    quoted = connection.ops.quote_name(relation_name)
    with connection.cursor() as cursor:
        cursor.execute(f"REFRESH MATERIALIZED VIEW {quoted}")

    rule.last_refreshed_at = timezone.now()
    rule.last_refresh_status = "success"
    rule.last_refresh_error = ""
    rule.save(update_fields=["last_refreshed_at", "last_refresh_status", "last_refresh_error"])
