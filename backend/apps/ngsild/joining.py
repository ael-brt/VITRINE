from __future__ import annotations

from typing import Any

from django.utils import timezone
from django.db.models import Exists, OuterRef
from django.db import connection

from .models import DashboardNgsiLdJoinRule, DashboardNgsiLdNormalizedEntity


def _extract_payload_path(payload: dict[str, Any], path: str) -> Any:
    current: Any = payload
    for key in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _extract_join_value(row: DashboardNgsiLdNormalizedEntity, key_path: str) -> str:
    if key_path.startswith("column."):
        field_name = key_path[len("column.") :]
        value = getattr(row, field_name, None)
    elif key_path.startswith("payload."):
        path = key_path[len("payload.") :]
        value = _extract_payload_path(row.entity_payload if isinstance(row.entity_payload, dict) else {}, path)
    else:
        # Backward-compatible fallback for historical rules using raw paths.
        value = _extract_payload_path(row.entity_payload if isinstance(row.entity_payload, dict) else {}, key_path)

    if isinstance(value, dict):
        value = value.get("value")
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _column_field_name(key_path: str) -> str | None:
    if not key_path.startswith("column."):
        return None
    field_name = key_path[len("column.") :].strip()
    if not field_name:
        return None
    allowed = {
        "id",
        "source_id",
        "dashboard_slug",
        "tenant",
        "entity_type",
        "entity_id",
        "join_key",
        "scope",
        "ngsi_updated_at",
        "ingested_at",
        "updated_at",
    }
    return field_name if field_name in allowed else None


def run_join_rule(
    *,
    dashboard_slug: str,
    rule_name: str | None = None,
    page: int = 1,
    page_size: int = 200,
) -> dict[str, Any]:
    rules_qs = DashboardNgsiLdJoinRule.objects.select_related("dashboard", "left_source", "right_source").filter(
        dashboard__slug=dashboard_slug,
        is_active=True,
    )
    if rule_name:
        rules_qs = rules_qs.filter(name=rule_name)

    rule = rules_qs.order_by("name").first()
    if not rule:
        return {
            "dashboard_slug": dashboard_slug,
            "rule": None,
            "detail": "No active join rule found for this dashboard.",
            "generated_at": timezone.now().isoformat(),
            "page": max(1, int(page)),
            "page_size": max(1, min(int(page_size), 1000)),
            "total_left_rows": 0,
            "total_items": 0,
            "matched_items": 0,
            "unmatched_items": 0,
            "items": [],
        }

    safe_page = max(1, int(page))
    safe_page_size = max(1, min(int(page_size), 1000))
    offset = (safe_page - 1) * safe_page_size
    relation_name = (rule.db_relation_name or "").strip()

    if relation_name:
        quoted = connection.ops.quote_name(relation_name)
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {quoted}")
            total_rows = int(cursor.fetchone()[0] or 0)

            cursor.execute(f"SELECT COUNT(*) FROM {quoted} WHERE matched = TRUE")
            matched_total = int(cursor.fetchone()[0] or 0)

            if rule.join_kind == DashboardNgsiLdJoinRule.JoinKind.INNER:
                cursor.execute(
                    f"""
                    SELECT left_source_id, left_entity_type, left_entity_id, left_tenant, left_join_key,
                           right_source_id, right_entity_type, right_entity_id, right_tenant, right_join_key,
                           matched
                    FROM {quoted}
                    WHERE matched = TRUE
                    ORDER BY left_entity_id, right_entity_id NULLS LAST
                    LIMIT %s OFFSET %s
                    """,
                    [safe_page_size, offset],
                )
            else:
                cursor.execute(
                    f"""
                    SELECT left_source_id, left_entity_type, left_entity_id, left_tenant, left_join_key,
                           right_source_id, right_entity_type, right_entity_id, right_tenant, right_join_key,
                           matched
                    FROM {quoted}
                    ORDER BY left_entity_id, right_entity_id NULLS LAST
                    LIMIT %s OFFSET %s
                    """,
                    [safe_page_size, offset],
                )
            rows = cursor.fetchall()

        items = []
        for row in rows:
            (
                left_source_id,
                left_entity_type,
                left_entity_id,
                left_tenant,
                left_join_key,
                right_source_id,
                right_entity_type,
                right_entity_id,
                right_tenant,
                right_join_key,
                matched,
            ) = row
            item = {
                "left": {
                    "source_id": left_source_id,
                    "entity_type": left_entity_type,
                    "entity_id": left_entity_id,
                    "tenant": left_tenant or "",
                    "join_key": left_join_key or "",
                },
                "left_key": left_join_key or "",
                "match_count": 1 if matched else 0,
                "matched": bool(matched),
                "right": [],
            }
            if matched and right_entity_id:
                item["right"] = [
                    {
                        "source_id": right_source_id,
                        "entity_type": right_entity_type,
                        "entity_id": right_entity_id,
                        "tenant": right_tenant or "",
                        "join_key": right_join_key or "",
                    }
                ]
            items.append(item)

        total_items = matched_total if rule.join_kind == DashboardNgsiLdJoinRule.JoinKind.INNER else total_rows
        unmatched_total = max(0, total_rows - matched_total)
        return {
            "dashboard_slug": dashboard_slug,
            "rule": {
                "name": rule.name,
                "join_kind": rule.join_kind,
                "left_source_id": rule.left_source_id,
                "left_tenant": rule.left_tenant,
                "left_entity_type": rule.left_entity_type,
                "left_key_path": rule.left_key_path,
                "right_source_id": rule.right_source_id,
                "right_tenant": rule.right_tenant,
                "right_entity_type": rule.right_entity_type,
                "right_key_path": rule.right_key_path,
                "storage_mode": rule.storage_mode,
            },
            "generated_at": timezone.now().isoformat(),
            "page": safe_page,
            "page_size": safe_page_size,
            "scalable_mode": True,
            "join_evaluation_mode": "db-relation",
            "total_left_rows": total_rows,
            "total_matched_left_rows": matched_total,
            "total_items": total_items,
            "matched_items": sum(1 for item in items if item["matched"]),
            "unmatched_items": sum(1 for item in items if not item["matched"]),
            "items": items,
            "totals": {"matched": matched_total, "unmatched": unmatched_total},
        }

    left_qs = DashboardNgsiLdNormalizedEntity.objects.filter(
        source=rule.left_source,
        entity_type=rule.left_entity_type,
    ).order_by("entity_id")
    if rule.left_tenant:
        left_qs = left_qs.filter(tenant=rule.left_tenant)

    right_qs = DashboardNgsiLdNormalizedEntity.objects.filter(
        source=rule.right_source,
        entity_type=rule.right_entity_type,
    )
    if rule.right_tenant:
        right_qs = right_qs.filter(tenant=rule.right_tenant)

    total_left_rows = left_qs.count()
    left_rows = list(left_qs[offset : offset + safe_page_size])

    left_column = _column_field_name(rule.left_key_path)
    right_column = _column_field_name(rule.right_key_path)
    scalable_mode = bool(left_column and right_column)

    right_index: dict[str, list[DashboardNgsiLdNormalizedEntity]] = {}
    if scalable_mode:
        left_keys = {
            _extract_join_value(row, rule.left_key_path)
            for row in left_rows
        }
        left_keys = {key for key in left_keys if key}
        if left_keys:
            scoped_right_rows = list(right_qs.filter(**{f"{right_column}__in": list(left_keys)}))
            for row in scoped_right_rows:
                key = _extract_join_value(row, rule.right_key_path)
                if not key:
                    continue
                right_index.setdefault(key, []).append(row)
    else:
        # Fallback mode for payload.* paths: functional but less scalable on large datasets.
        for row in right_qs.iterator(chunk_size=1000):
            key = _extract_join_value(row, rule.right_key_path)
            if not key:
                continue
            right_index.setdefault(key, []).append(row)
    items: list[dict[str, Any]] = []
    matched_items = 0
    unmatched_items = 0

    for left in left_rows:
        left_key = _extract_join_value(left, rule.left_key_path)
        matches = right_index.get(left_key, []) if left_key else []

        if matches:
            matched_items += 1
            items.append(
                {
                    "left": {
                        "source_id": left.source_id,
                        "entity_type": left.entity_type,
                        "entity_id": left.entity_id,
                        "tenant": left.tenant,
                        "join_key": left.join_key,
                    },
                    "left_key": left_key,
                    "match_count": len(matches),
                    "matched": True,
                    "right": [
                        {
                            "source_id": right.source_id,
                            "entity_type": right.entity_type,
                            "entity_id": right.entity_id,
                            "tenant": right.tenant,
                            "join_key": right.join_key,
                        }
                        for right in matches
                    ],
                }
            )
            continue

        unmatched_items += 1
        if rule.join_kind == DashboardNgsiLdJoinRule.JoinKind.LEFT:
            items.append(
                {
                    "left": {
                        "source_id": left.source_id,
                        "entity_type": left.entity_type,
                        "entity_id": left.entity_id,
                        "tenant": left.tenant,
                        "join_key": left.join_key,
                    },
                    "left_key": left_key,
                    "match_count": 0,
                    "matched": False,
                    "right": [],
                }
            )

    if rule.join_kind == DashboardNgsiLdJoinRule.JoinKind.INNER:
        items = [item for item in items if item["matched"]]

    total_matched_rows: int | None = None
    if scalable_mode:
        exists_subquery = right_qs.filter(**{right_column: OuterRef(left_column)})
        total_matched_rows = left_qs.annotate(_has_match=Exists(exists_subquery)).filter(_has_match=True).count()

    return {
        "dashboard_slug": dashboard_slug,
        "rule": {
            "name": rule.name,
            "join_kind": rule.join_kind,
            "left_source_id": rule.left_source_id,
            "left_tenant": rule.left_tenant,
            "left_entity_type": rule.left_entity_type,
            "left_key_path": rule.left_key_path,
            "right_source_id": rule.right_source_id,
            "right_tenant": rule.right_tenant,
            "right_entity_type": rule.right_entity_type,
            "right_key_path": rule.right_key_path,
            "storage_mode": rule.storage_mode,
        },
        "generated_at": timezone.now().isoformat(),
        "page": safe_page,
        "page_size": safe_page_size,
        "scalable_mode": scalable_mode,
        "join_evaluation_mode": "column-db" if scalable_mode else "payload-python",
        "total_left_rows": total_left_rows,
        "total_matched_left_rows": total_matched_rows,
        "total_items": len(items),
        "matched_items": matched_items,
        "unmatched_items": unmatched_items,
        "items": items,
    }
