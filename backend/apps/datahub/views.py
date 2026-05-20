from __future__ import annotations

import json

from django.db import connection
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Dashboard, EntityTable, SqlView
from .security import user_environment_ids


def _q(name: str) -> str:
    return connection.ops.quote_name(name)


def _parse_geojson(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _can_access_sql_view(*, user, sql_view: SqlView) -> bool:
    env_ids = user_environment_ids(user)
    if not sql_view.is_active:
        return False
    view_env_ids = set(sql_view.environments.values_list("id", flat=True))
    if not view_env_ids:
        return True
    return bool(env_ids.intersection(view_env_ids))


class EntityTableListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        env_ids = user_environment_ids(request.user)
        qs = EntityTable.objects.select_related("environment", "tenant").filter(is_active=True, environment_id__in=env_ids).order_by("tenant__slug", "entity_type")
        items = [
            {
                "id": row.id,
                "tenant": row.tenant.slug,
                "entity_type": row.entity_type,
                "table_name": row.table_name,
                "environment": row.environment.slug,
            }
            for row in qs
        ]
        return Response({"total_items": len(items), "items": items})


class EntityTableSearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, entity_type: str):
        tenant_slug = (request.query_params.get("tenant") or "").strip()
        qs = EntityTable.objects.select_related("tenant", "environment").filter(is_active=True, entity_type=entity_type)
        if tenant_slug:
            qs = qs.filter(tenant__slug=tenant_slug)
        count = qs.count()
        if count == 0:
            return Response({"detail": "Entity type not found."}, status=404)
        if count > 1 and not tenant_slug:
            return Response(
                {"detail": "Multiple entity tables found for this type. Add ?tenant=<tenant-slug>."},
                status=400,
            )
        table = qs.first()
        env_ids = user_environment_ids(request.user)
        if table.environment_id not in env_ids:
            return Response({"detail": "Access denied."}, status=403)

        q = (request.query_params.get("q") or "").strip()
        try:
            page = max(1, int(request.query_params.get("page", "1")))
            page_size = max(1, min(int(request.query_params.get("page_size", "100")), 1000))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Invalid pagination parameters. Use integers for page and page_size."},
                status=400,
            )
        offset = (page - 1) * page_size
        where_sql = ""
        params = []
        if q:
            where_sql = "WHERE entity_id ILIKE %s OR search_text ILIKE %s"
            like = f"%{q}%"
            params.extend([like, like])

        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {_q(table.table_name)} {where_sql}", params)
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(
                f"SELECT * FROM {_q(table.table_name)} {where_sql} ORDER BY id DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = cursor.fetchall()

        return Response(
            {
                "entity_type": table.entity_type,
                "tenant": table.tenant.slug,
                "environment": table.environment.slug,
                "table_name": table.table_name,
                "q": q,
                "page": page,
                "page_size": page_size,
                "total_rows": total,
                "items": [dict(zip(columns, row)) for row in rows],
            }
        )


class EntityTableRowsByNameView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, table_name: str):
        table = get_object_or_404(
            EntityTable.objects.select_related("tenant", "environment"),
            table_name=table_name,
            is_active=True,
        )
        env_ids = user_environment_ids(request.user)
        if table.environment_id not in env_ids:
            return Response({"detail": "Access denied."}, status=403)
        q = (request.query_params.get("q") or "").strip()
        try:
            page = max(1, int(request.query_params.get("page", "1")))
            page_size = max(1, min(int(request.query_params.get("page_size", "100")), 1000))
        except (TypeError, ValueError):
            return Response({"detail": "Invalid pagination parameters."}, status=400)
        offset = (page - 1) * page_size
        where_sql = ""
        params = []
        if q:
            where_sql = "WHERE entity_id ILIKE %s OR search_text ILIKE %s"
            like = f"%{q}%"
            params.extend([like, like])
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {_q(table.table_name)} {where_sql}", params)
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(
                f"SELECT * FROM {_q(table.table_name)} {where_sql} ORDER BY id DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = cursor.fetchall()
        return Response(
            {
                "table_name": table.table_name,
                "entity_type": table.entity_type,
                "tenant": table.tenant.slug,
                "environment": table.environment.slug,
                "page": page,
                "page_size": page_size,
                "total_rows": total,
                "items": [dict(zip(columns, row)) for row in rows],
            }
        )


class SqlViewListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = SqlView.objects.prefetch_related("environments").filter(is_active=True).order_by("slug")
        items = []
        for row in qs:
            if not _can_access_sql_view(user=request.user, sql_view=row):
                continue
            items.append(
                {
                    "slug": row.slug,
                    "name": row.name,
                    "storage_mode": row.storage_mode,
                    "relation": row.db_relation_name,
                    "environments": list(row.environments.values_list("slug", flat=True)),
                }
            )
        return Response({"total_items": len(items), "items": items})


class SqlViewGeoJsonView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        sql_view = get_object_or_404(SqlView, slug=slug, is_active=True)
        if not _can_access_sql_view(user=request.user, sql_view=sql_view):
            return Response({"detail": "Access denied."}, status=403)
        if not sql_view.db_relation_name:
            return Response({"detail": "SQL view is not deployed."}, status=400)

        quoted = _q(sql_view.db_relation_name)
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT * FROM {quoted}")
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = cursor.fetchall()

        features = []
        for row in rows:
            item = dict(zip(columns, row))
            geom = None
            for key in ("geometry", "localisation_geojson", "c_localisation_geojson", "here_payload_json"):
                if key in item:
                    geom = _parse_geojson(item.get(key))
                    if geom and "type" in geom:
                        break
            if not geom:
                continue
            features.append({"type": "Feature", "geometry": geom, "properties": item})
        return Response({"type": "FeatureCollection", "features": features})


class SqlViewRowsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        sql_view = get_object_or_404(SqlView, slug=slug, is_active=True)
        if not _can_access_sql_view(user=request.user, sql_view=sql_view):
            return Response({"detail": "Access denied."}, status=403)
        if not sql_view.db_relation_name:
            return Response({"detail": "SQL view is not deployed."}, status=400)
        try:
            page = max(1, int(request.query_params.get("page", "1")))
            page_size = max(1, min(int(request.query_params.get("page_size", "100")), 1000))
        except (TypeError, ValueError):
            return Response({"detail": "Invalid pagination parameters."}, status=400)
        offset = (page - 1) * page_size
        quoted = _q(sql_view.db_relation_name)
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {quoted}")
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(f"SELECT * FROM {quoted} LIMIT %s OFFSET %s", [page_size, offset])
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = [dict(zip(columns, r)) for r in cursor.fetchall()]
        return Response(
            {
                "slug": sql_view.slug,
                "relation": sql_view.db_relation_name,
                "page": page,
                "page_size": page_size,
                "total_rows": total,
                "items": rows,
            }
        )


class DashboardListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        env_ids = user_environment_ids(request.user)
        qs = Dashboard.objects.filter(is_active=True).prefetch_related("environments").order_by("slug")
        items = []
        for row in qs:
            dashboard_env_ids = set(row.environments.values_list("id", flat=True))
            if row.is_protected and dashboard_env_ids and not env_ids.intersection(dashboard_env_ids):
                continue
            items.append(
                {
                    "slug": row.slug,
                    "title": row.title,
                    "description": row.description,
                    "is_protected": row.is_protected,
                }
            )
        return Response(items)


class DashboardDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        row = get_object_or_404(Dashboard.objects.prefetch_related("environments"), slug=slug, is_active=True)
        env_ids = user_environment_ids(request.user)
        dashboard_env_ids = set(row.environments.values_list("id", flat=True))
        if row.is_protected and dashboard_env_ids and not env_ids.intersection(dashboard_env_ids):
            return Response({"detail": "Access denied."}, status=403)
        return Response(
            {
                "slug": row.slug,
                "title": row.title,
                "description": row.description,
                "is_protected": row.is_protected,
            }
        )


class DashboardDataView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        row = get_object_or_404(Dashboard.objects.prefetch_related("environments"), slug=slug, is_active=True)
        env_ids = user_environment_ids(request.user)
        dashboard_env_ids = set(row.environments.values_list("id", flat=True))
        if row.is_protected and dashboard_env_ids and not env_ids.intersection(dashboard_env_ids):
            return Response({"detail": "Access denied."}, status=403)
        total = 0
        if row.sql_view and row.sql_view.db_relation_name:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {_q(row.sql_view.db_relation_name)}")
                total = int(cursor.fetchone()[0] or 0)
        return Response(
            {
                "dashboard_slug": row.slug,
                "entity_type": None,
                "total_entities": total,
                "stats": {"line_count": total, "point_count": 0, "unknown_geometry_count": 0},
                "sample_ids": [],
            }
        )


class DashboardKpisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        row = get_object_or_404(Dashboard.objects.prefetch_related("environments"), slug=slug, is_active=True)
        env_ids = user_environment_ids(request.user)
        dashboard_env_ids = set(row.environments.values_list("id", flat=True))
        if row.is_protected and dashboard_env_ids and not env_ids.intersection(dashboard_env_ids):
            return Response({"detail": "Access denied."}, status=403)
        total = 0
        if row.sql_view and row.sql_view.db_relation_name:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {_q(row.sql_view.db_relation_name)}")
                total = int(cursor.fetchone()[0] or 0)
        return Response(
            {
                "dashboard_slug": row.slug,
                "entity_type": None,
                "tenant": None,
                "total_entities": total,
                "with_join_key": total,
                "with_tenant": total,
                "with_ngsi_updated_at": 0,
                "latest_ngsi_updated_at": None,
                "counts_by_type": [],
            }
        )


class DashboardJoinedKpisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        row = get_object_or_404(Dashboard.objects.prefetch_related("environments"), slug=slug, is_active=True)
        env_ids = user_environment_ids(request.user)
        dashboard_env_ids = set(row.environments.values_list("id", flat=True))
        if row.is_protected and dashboard_env_ids and not env_ids.intersection(dashboard_env_ids):
            return Response({"detail": "Access denied."}, status=403)
        total = 0
        if row.sql_view and row.sql_view.db_relation_name:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {_q(row.sql_view.db_relation_name)}")
                total = int(cursor.fetchone()[0] or 0)
        return Response(
            {
                "dashboard_slug": row.slug,
                "rule": {"name": "sql_view"},
                "scalable_mode": True,
                "join_evaluation_mode": "sql_view",
                "total_left_rows": total,
                "total_matched_left_rows": total,
                "matched_items": total,
                "unmatched_items": 0,
            }
        )


class DashboardMapView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        row = get_object_or_404(Dashboard.objects.prefetch_related("environments"), slug=slug, is_active=True)
        env_ids = user_environment_ids(request.user)
        dashboard_env_ids = set(row.environments.values_list("id", flat=True))
        if row.is_protected and dashboard_env_ids and not env_ids.intersection(dashboard_env_ids):
            return Response({"detail": "Access denied."}, status=403)
        if not row.sql_view or not row.sql_view.db_relation_name:
            return Response(
                {
                    "dashboard_slug": row.slug,
                    "entity_type": None,
                    "tenant": None,
                    "join_key": None,
                    "page": 1,
                    "page_size": 0,
                    "total_rows": 0,
                    "total_items": 0,
                    "items": [],
                }
            )
        try:
            page = max(1, int(request.query_params.get("page", "1")))
            page_size = max(1, min(int(request.query_params.get("page_size", "100")), 1000))
        except (TypeError, ValueError):
            return Response({"detail": "Invalid pagination parameters."}, status=400)
        offset = (page - 1) * page_size
        quoted = _q(row.sql_view.db_relation_name)
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {quoted}")
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(f"SELECT * FROM {quoted} LIMIT %s OFFSET %s", [page_size, offset])
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = [dict(zip(columns, r)) for r in cursor.fetchall()]
        items = []
        for item in rows:
            geom = None
            for key in ("geometry", "localisation_geojson", "c_localisation_geojson"):
                if key in item:
                    geom = _parse_geojson(item.get(key))
                    if geom:
                        break
            items.append(
                {
                    "id": str(item.get("entity_id") or item.get("id") or ""),
                    "type": str(item.get("entity_type") or ""),
                    "tenant": str(item.get("tenant_id") or ""),
                    "join_key": str(item.get("aPourTronconDeRoute") or item.get("entity_id") or ""),
                    "scope": str(item.get("scope") or ""),
                    "geometry": geom,
                }
            )
        return Response(
            {
                "dashboard_slug": row.slug,
                "entity_type": None,
                "tenant": None,
                "join_key": None,
                "page": page,
                "page_size": page_size,
                "total_rows": total,
                "total_items": len(items),
                "items": items,
            }
        )
