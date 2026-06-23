from __future__ import annotations

import json
import os

from django.conf import settings
from django.db import connection
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .media_storage import (
    build_internal_file_url,
    build_internal_media_url,
    normalize_referenced_media_path,
    resolve_referenced_media_path,
    resolve_storage_path,
    store_uploaded_file,
)
from .models import Dashboard, EntityTable, Environment, MediaAsset, SqlView
from .security import user_environment_ids, user_is_global_admin


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


def _can_access_dashboard(*, user, dashboard: Dashboard) -> bool:
    env_ids = user_environment_ids(user)
    dashboard_env_ids = set(dashboard.environments.values_list("id", flat=True))
    if dashboard.is_protected and dashboard_env_ids and not env_ids.intersection(dashboard_env_ids):
        return False
    return True


def _can_access_media_asset(*, user, asset: MediaAsset) -> bool:
    if asset.is_public:
        return True
    if user_is_global_admin(user):
        return True
    if not getattr(user, "is_authenticated", False):
        return False

    env_ids = user_environment_ids(user)
    asset_env_ids = set(asset.environments.values_list("id", flat=True))
    if asset_env_ids:
        return bool(env_ids.intersection(asset_env_ids))

    if asset.dashboard_id and asset.dashboard:
        return _can_access_dashboard(user=user, dashboard=asset.dashboard)

    return False


def _serialize_media_asset(asset: MediaAsset) -> dict:
    return {
        "id": asset.id,
        "dashboard_slug": asset.dashboard.slug if asset.dashboard_id and asset.dashboard else None,
        "entity_type": asset.entity_type,
        "entity_id": asset.entity_id,
        "category": asset.category,
        "title": asset.title,
        "description": asset.description,
        "original_name": asset.original_name,
        "mime_type": asset.mime_type,
        "size_bytes": asset.size_bytes,
        "checksum_sha256": asset.checksum_sha256,
        "is_public": asset.is_public,
        "file_url": f"/api/v1/datahub/media-assets/{asset.id}/file/",
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
        "environments": list(asset.environments.values_list("slug", flat=True)),
    }


def _find_first_value(item: dict[str, object], aliases: tuple[str, ...]) -> object | None:
    normalized_aliases = {"".join(ch for ch in alias.lower() if ch.isalnum()) for alias in aliases}
    for key, value in item.items():
        normalized_key = "".join(ch for ch in str(key).lower() if ch.isalnum())
        if normalized_key in normalized_aliases:
            return value
    return None


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


class MediaAssetListView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        qs = MediaAsset.objects.select_related("dashboard", "uploaded_by").prefetch_related("environments").order_by("id")

        dashboard_slug = (request.query_params.get("dashboard_slug") or "").strip()
        entity_type = (request.query_params.get("entity_type") or "").strip()
        entity_id = (request.query_params.get("entity_id") or "").strip()
        category = (request.query_params.get("category") or "").strip()

        if dashboard_slug:
            qs = qs.filter(dashboard__slug=dashboard_slug)
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if entity_id:
            qs = qs.filter(entity_id=entity_id)
        if category:
            qs = qs.filter(category=category)

        items = [_serialize_media_asset(asset) for asset in qs if _can_access_media_asset(user=request.user, asset=asset)]
        return Response({"total_items": len(items), "items": items})

    def post(self, request):
        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            return Response({"detail": "File is required."}, status=status.HTTP_400_BAD_REQUEST)
        max_size = int(getattr(settings, "MEDIA_UPLOAD_MAX_BYTES", 104857600))
        if uploaded_file.size > max_size:
            return Response({"detail": f"File too large. Maximum size is {max_size} bytes."}, status=status.HTTP_400_BAD_REQUEST)

        dashboard_slug = (request.data.get("dashboard_slug") or "").strip()
        dashboard = None
        if dashboard_slug:
            dashboard = get_object_or_404(Dashboard.objects.prefetch_related("environments"), slug=dashboard_slug, is_active=True)
            if not _can_access_dashboard(user=request.user, dashboard=dashboard):
                return Response({"detail": "Access denied for dashboard."}, status=status.HTTP_403_FORBIDDEN)

        entity_type = str(request.data.get("entity_type") or "").strip()
        entity_id = str(request.data.get("entity_id") or "").strip()
        category = str(request.data.get("category") or MediaAsset.Category.OTHER).strip()
        if category not in MediaAsset.Category.values:
            return Response({"detail": "Invalid category."}, status=status.HTTP_400_BAD_REQUEST)

        environment_ids = request.data.getlist("environment_ids")
        environments = []
        if environment_ids:
            try:
                env_ids = [int(value) for value in environment_ids if str(value).strip()]
            except ValueError:
                return Response({"detail": "Invalid environment_ids."}, status=status.HTTP_400_BAD_REQUEST)
            allowed_env_ids = user_environment_ids(request.user)
            environments = list(Environment.objects.filter(id__in=env_ids))
            if len(environments) != len(set(env_ids)):
                return Response({"detail": "One or more environments do not exist."}, status=status.HTTP_400_BAD_REQUEST)
            if not all(env.id in allowed_env_ids for env in environments):
                return Response({"detail": "Access denied for selected environments."}, status=status.HTTP_403_FORBIDDEN)
            if dashboard:
                dashboard_env_ids = set(dashboard.environments.values_list("id", flat=True))
                if dashboard_env_ids and not all(env.id in dashboard_env_ids for env in environments):
                    return Response(
                        {"detail": "Selected environments must belong to the target dashboard."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        stored = store_uploaded_file(
            uploaded_file,
            dashboard_slug=dashboard.slug if dashboard else "global",
            entity_type=entity_type or "asset",
            entity_id=entity_id or "",
        )
        asset = MediaAsset.objects.create(
            dashboard=dashboard,
            entity_type=entity_type,
            entity_id=entity_id,
            category=category,
            title=str(request.data.get("title") or "").strip(),
            description=str(request.data.get("description") or "").strip(),
            storage_key=str(stored["storage_key"]),
            original_name=str(stored["original_name"]),
            mime_type=str(stored["mime_type"]),
            size_bytes=int(stored["size_bytes"]),
            checksum_sha256=str(stored["checksum_sha256"]),
            is_public=str(request.data.get("is_public") or "").strip().lower() in {"1", "true", "yes", "oui"},
            uploaded_by=request.user,
        )
        if environments:
            asset.environments.set(environments)
        elif dashboard:
            asset.environments.set(dashboard.environments.all())

        return Response(_serialize_media_asset(asset), status=status.HTTP_201_CREATED)


class MediaAssetDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, asset_id: int):
        asset = get_object_or_404(
            MediaAsset.objects.select_related("dashboard", "uploaded_by").prefetch_related("environments"),
            id=asset_id,
        )
        if not _can_access_media_asset(user=request.user, asset=asset):
            return Response({"detail": "Access denied."}, status=status.HTTP_403_FORBIDDEN)
        return Response(_serialize_media_asset(asset))


class MediaAssetFileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, asset_id: int):
        asset = get_object_or_404(
            MediaAsset.objects.select_related("dashboard").prefetch_related("environments"),
            id=asset_id,
        )
        if not _can_access_media_asset(user=request.user, asset=asset):
            return Response({"detail": "Access denied."}, status=status.HTTP_403_FORBIDDEN)

        try:
            path = resolve_storage_path(asset.storage_key)
        except ValueError as exc:
            raise Http404(str(exc)) from exc
        if not path.exists() or not path.is_file():
            raise Http404("Media file not found.")

        as_attachment = (request.query_params.get("download") or "").strip().lower() in {"1", "true", "yes"}
        internal_redirect = getattr(settings, "MEDIA_INTERNAL_URL_PREFIX", "/protected-media/")
        if internal_redirect:
            response = HttpResponse()
            response["Content-Type"] = asset.mime_type or "application/octet-stream"
            response["Content-Length"] = str(asset.size_bytes)
            disposition = "attachment" if as_attachment else "inline"
            response["Content-Disposition"] = f'{disposition}; filename="{os.path.basename(asset.original_name)}"'
            response["X-Accel-Redirect"] = build_internal_media_url(asset.storage_key)
            return response

        response = FileResponse(path.open("rb"), content_type=asset.mime_type or "application/octet-stream")
        if as_attachment:
            response["Content-Disposition"] = f'attachment; filename="{os.path.basename(asset.original_name)}"'
        return response


class Ceremap3DPanelImageView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        dashboard = get_object_or_404(Dashboard.objects.select_related("sql_view").prefetch_related("environments"), slug="ceremap3d", is_active=True)
        if not _can_access_dashboard(user=request.user, dashboard=dashboard):
            return Response({"detail": "Access denied."}, status=status.HTTP_403_FORBIDDEN)

        raw_path = (request.query_params.get("path") or "").strip() or None
        entity_id = (request.query_params.get("entity_id") or "").strip()

        if not raw_path:
            if not entity_id:
                return Response({"detail": "Provide entity_id or path."}, status=status.HTTP_400_BAD_REQUEST)
            if not dashboard.sql_view or not dashboard.sql_view.db_relation_name:
                return Response({"detail": "Ceremap3D SQL view is not deployed."}, status=status.HTTP_400_BAD_REQUEST)

            quoted_relation = _q(dashboard.sql_view.db_relation_name)
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT * FROM {quoted_relation} WHERE entity_id = %s LIMIT 1", [entity_id])
                row = cursor.fetchone()
                columns = [desc[0] for desc in (cursor.description or [])]
            if not row:
                return Response({"detail": "Panneau not found in Ceremap3D view."}, status=status.HTTP_404_NOT_FOUND)

            row_data = dict(zip(columns, row))
            raw_path = _find_first_value(row_data, ("first_image_path", "imgpath", "image_path"))

        normalized_path = normalize_referenced_media_path(raw_path)
        if not normalized_path:
            return Response({"detail": "No valid image path found for this panneau."}, status=status.HTTP_404_NOT_FOUND)

        try:
            _, file_path = resolve_referenced_media_path(settings.CEREMAP3D_IMAGE_ROOT, normalized_path)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not file_path.exists() or not file_path.is_file():
            return Response({"detail": "Image file not found on server."}, status=status.HTTP_404_NOT_FOUND)

        as_attachment = (request.query_params.get("download") or "").strip().lower() in {"1", "true", "yes"}
        internal_prefix = (settings.CEREMAP3D_IMAGE_INTERNAL_URL_PREFIX or "").strip()
        if internal_prefix:
            response = HttpResponse()
            response["Content-Type"] = "application/octet-stream"
            response["Content-Length"] = str(file_path.stat().st_size)
            disposition = "attachment" if as_attachment else "inline"
            response["Content-Disposition"] = f'{disposition}; filename="{os.path.basename(file_path.name)}"'
            response["X-Accel-Redirect"] = build_internal_file_url(normalized_path, internal_prefix)
            return response

        response = FileResponse(file_path.open("rb"))
        if as_attachment:
            response["Content-Disposition"] = f'attachment; filename="{os.path.basename(file_path.name)}"'
        return response


class Ceremap3DCategorySymbolView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        get_object_or_404(Dashboard, slug="ceremap3d", is_active=True)

        category = (request.query_params.get("category") or "").strip()
        if not category:
            return Response({"detail": "Provide category."}, status=status.HTTP_400_BAD_REQUEST)

        safe_category = normalize_referenced_media_path(f"Signalisation/{category}.png")
        if not safe_category:
            return Response({"detail": "Invalid category."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            _, file_path = resolve_referenced_media_path(settings.CEREMAP3D_IMAGE_ROOT, safe_category)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not file_path.exists() or not file_path.is_file():
            return Response({"detail": "Symbol file not found on server."}, status=status.HTTP_404_NOT_FOUND)

        internal_prefix = (settings.CEREMAP3D_IMAGE_INTERNAL_URL_PREFIX or "").strip()
        if internal_prefix:
            response = HttpResponse()
            response["Content-Type"] = "image/png"
            response["Content-Length"] = str(file_path.stat().st_size)
            response["Content-Disposition"] = f'inline; filename="{os.path.basename(file_path.name)}"'
            response["X-Accel-Redirect"] = build_internal_file_url(safe_category, internal_prefix)
            return response

        return FileResponse(file_path.open("rb"), content_type="image/png")


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
