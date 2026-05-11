from __future__ import annotations

import re
import json
from typing import Any

from django.db import connection, transaction
from django.utils.text import slugify

from .models import EntityTable, Tenant


class DatahubTableError(RuntimeError):
    pass


SAFE_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def normalize_table_name(entity_type: str) -> str:
    base = slugify(entity_type).replace("-", "_")
    return f"ent_{base}"[:120]


def _q(name: str) -> str:
    return connection.ops.quote_name(name)


def _datahub_table(model_name: str) -> str:
    return f"{Tenant._meta.app_label}_{model_name}"


def _validate_identifier(name: str) -> str:
    if not SAFE_IDENT.match(name):
        raise DatahubTableError(f"Invalid SQL identifier: {name}")
    return name


def ensure_entity_table_schema(entity_table: EntityTable) -> None:
    table_name = _validate_identifier(entity_table.table_name)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {_q(table_name)} (
                id BIGSERIAL PRIMARY KEY,
                tenant_id bigint NOT NULL REFERENCES {_q(_datahub_table('tenant'))}(id) ON DELETE RESTRICT,
                entity_type varchar(120) NOT NULL,
                entity_id varchar(255) NOT NULL,
                search_text text NOT NULL DEFAULT '',
                payload_json jsonb NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (tenant_id, entity_type, entity_id)
            )
            """
        )
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS {_q(table_name + '_entity_id_idx')} ON {_q(table_name)} (entity_id)"
        )
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS {_q(table_name + '_tenant_idx')} ON {_q(table_name)} (tenant_id)"
        )
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS {_q(table_name + '_search_idx')} ON {_q(table_name)} USING GIN (to_tsvector('simple', search_text))"
        )


def _simple_value(value: Any) -> tuple[str, Any] | None:
    if isinstance(value, dict):
        value = value.get("value")
    if isinstance(value, bool):
        return "boolean", value
    if isinstance(value, int) and not isinstance(value, bool):
        return "bigint", value
    if isinstance(value, float):
        return "double precision", value
    if isinstance(value, str):
        if len(value) <= 2000:
            return "text", value
    return None


def _geo_value(value: Any) -> tuple[str, Any] | None:
    if not isinstance(value, dict):
        return None
    if value.get("type") != "GeoProperty":
        return None
    geometry = value.get("value")
    if not isinstance(geometry, dict):
        return None
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if not isinstance(gtype, str) or not gtype:
        return None
    if coords is None:
        return None
    return gtype, geometry


def _safe_col(name: str) -> str:
    slug = slugify(name).replace("-", "_")
    slug = re.sub(r"_+", "_", slug).strip("_")
    if not slug:
        slug = "attr"
    return ("c_" + slug)[:58]


def ensure_columns_for_payload(entity_table: EntityTable, entity: dict[str, Any]) -> dict[str, Any]:
    table_name = _validate_identifier(entity_table.table_name)
    mapping: dict[str, tuple[str, Any]] = {}
    for key, value in entity.items():
        if key in {"id", "type"}:
            continue
        parsed = _simple_value(value)
        if parsed:
            col = _safe_col(key)
            mapping[col] = parsed
            continue

        geo = _geo_value(value)
        if geo:
            geo_type, geo_json = geo
            base = _safe_col(key)
            mapping[f"{base}_geo_type"] = ("text", geo_type)
            mapping[f"{base}_geojson"] = ("jsonb", geo_json)

    if not mapping:
        return {}

    existing = set()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name=%s
            """,
            [table_name],
        )
        existing = {row[0] for row in cursor.fetchall()}

    with connection.cursor() as cursor:
        for col, (sql_type, _value) in mapping.items():
            if col in existing:
                continue
            _validate_identifier(col)
            cursor.execute(f"ALTER TABLE {_q(table_name)} ADD COLUMN {_q(col)} {sql_type} NULL")
    return {col: value for col, (_type, value) in mapping.items()}


def _search_text(entity: dict[str, Any]) -> str:
    out = []
    for key, value in entity.items():
        if isinstance(value, dict):
            value = value.get("value")
        if isinstance(value, (str, int, float, bool)):
            out.append(f"{key}:{value}")
    return " | ".join(out)[:30000]


def upsert_entities(
    *,
    entity_table: EntityTable,
    tenant: Tenant,
    entity_type: str,
    entities: list[dict[str, Any]],
    mode: str,
) -> tuple[int, int]:
    table_name = _validate_identifier(entity_table.table_name)
    touched_ids: list[str] = []
    written = 0
    with transaction.atomic():
        for entity in entities:
            entity_id = entity.get("id")
            if not isinstance(entity_id, str) or not entity_id:
                continue
            typed_cols = ensure_columns_for_payload(entity_table, entity)
            touched_ids.append(entity_id)
            col_names = ["tenant_id", "entity_type", "entity_id", "search_text", "payload_json"]
            values: list[Any] = [tenant.id, entity_type, entity_id, _search_text(entity), json.dumps(entity, ensure_ascii=False)]
            for col, val in typed_cols.items():
                col_names.append(col)
                # psycopg raw SQL binding needs explicit serialization for jsonb placeholders.
                if col.endswith("_geojson"):
                    values.append(json.dumps(val, ensure_ascii=False))
                else:
                    values.append(val)

            insert_cols_sql = ", ".join(_q(col) for col in col_names)
            # Force jsonb casting for payload_json and geojson placeholders.
            placeholder_parts = ["%s"] * len(col_names)
            jsonb_cols = {"payload_json"} | {name for name in col_names if name.endswith("_geojson")}
            for idx, name in enumerate(col_names):
                if name in jsonb_cols:
                    placeholder_parts[idx] = "%s::jsonb"
            placeholders = ", ".join(placeholder_parts)
            update_cols = ["search_text", "payload_json"] + list(typed_cols.keys())
            update_sql = ", ".join(f"{_q(col)} = EXCLUDED.{_q(col)}" for col in update_cols) + ", updated_at = NOW()"
            typed_values = values
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    INSERT INTO {_q(table_name)} ({insert_cols_sql})
                    VALUES ({placeholders})
                    ON CONFLICT (tenant_id, entity_type, entity_id)
                    DO UPDATE SET {update_sql}
                    """,
                    typed_values,
                )
            written += 1

        deleted = 0
        if mode == "full":
            with connection.cursor() as cursor:
                if touched_ids:
                    cursor.execute(
                        f"""
                        DELETE FROM {_q(table_name)}
                        WHERE tenant_id=%s AND entity_type=%s AND entity_id <> ALL(%s)
                        """,
                        [tenant.id, entity_type, touched_ids],
                    )
                else:
                    cursor.execute(
                        f"DELETE FROM {_q(table_name)} WHERE tenant_id=%s AND entity_type=%s",
                        [tenant.id, entity_type],
                    )
                deleted = cursor.rowcount or 0
        return written, deleted


def delete_entity_table_physical(entity_table: EntityTable) -> None:
    table_name = _validate_identifier(entity_table.table_name)
    with connection.cursor() as cursor:
        cursor.execute(f"DROP TABLE IF EXISTS {_q(table_name)} CASCADE")
