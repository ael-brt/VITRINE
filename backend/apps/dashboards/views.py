from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.datahub.models import SqlView
from apps.datahub.security import user_environment_ids
from apps.datahub.service import fetch_binding_kpis, fetch_binding_map, resolve_dashboard_binding_for_user

from .models import Dashboard
from .serializers import DashboardSerializer


class DashboardViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Dashboard.objects.select_related("tenant").all().order_by("tenant__slug", "slug")
    serializer_class = DashboardSerializer
    lookup_field = "slug"

    def get_queryset(self):
        qs = super().get_queryset()
        allowed = user_environment_ids(self.request.user)
        if not allowed:
            return qs.none()
        qs = qs.filter(dataset_binding__environment_id__in=allowed, dataset_binding__is_active=True)
        tenant_slug = self.request.query_params.get("tenant")
        if tenant_slug:
            qs = qs.filter(tenant__slug=tenant_slug)
        return qs


class DashboardDataView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        dashboard = get_object_or_404(Dashboard, slug=slug)
        binding = resolve_dashboard_binding_for_user(dashboard_slug=dashboard.slug, user=request.user)
        if not binding:
            return Response({"detail": "No accessible dataset for this dashboard."}, status=status.HTTP_403_FORBIDDEN)
        try:
            page = int(request.query_params.get("page", "1"))
            page_size = int(request.query_params.get("page_size", request.query_params.get("limit", "200")))
        except Exception:
            page, page_size = 1, 200
        payload = fetch_binding_map(binding=binding, page=page, page_size=page_size)
        payload["dashboard_slug"] = dashboard.slug
        return Response(payload, status=status.HTTP_200_OK)


class DashboardMapView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        dashboard = get_object_or_404(Dashboard, slug=slug)
        binding = resolve_dashboard_binding_for_user(dashboard_slug=dashboard.slug, user=request.user)
        if not binding:
            return Response({"detail": "No accessible dataset for this dashboard."}, status=status.HTTP_403_FORBIDDEN)
        try:
            page = int(request.query_params.get("page", "1"))
        except Exception:
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", request.query_params.get("limit", "200")))
        except Exception:
            page_size = 200
        payload = fetch_binding_map(binding=binding, page=page, page_size=page_size)
        payload["dashboard_slug"] = dashboard.slug
        return Response(payload)


class DashboardKpisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        dashboard = get_object_or_404(Dashboard, slug=slug)
        binding = resolve_dashboard_binding_for_user(dashboard_slug=dashboard.slug, user=request.user)
        if not binding:
            return Response({"detail": "No accessible dataset for this dashboard."}, status=status.HTTP_403_FORBIDDEN)
        payload = fetch_binding_kpis(binding=binding)
        payload["dashboard_slug"] = dashboard.slug
        return Response(payload)


class DashboardTimeseriesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        return DashboardMapView().get(request, slug)


class DashboardJoinedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str):
        return DashboardMapView().get(request, slug)


class DashboardRelationDataView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str, relation_slug: str):
        relation = get_object_or_404(SqlView.objects.filter(is_active=True), slug=relation_slug)
        allowed = user_environment_ids(request.user)
        if not relation.environments.filter(id__in=allowed).exists():
            return Response({"detail": "Access denied for this environment."}, status=status.HTTP_403_FORBIDDEN)
        if not relation.db_relation_name:
            return Response({"detail": "SQL view is not deployed yet."}, status=status.HTTP_409_CONFLICT)
        try:
            page = int(request.query_params.get("page", "1"))
        except Exception:
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", request.query_params.get("limit", "200")))
        except Exception:
            page_size = 200
        from apps.datahub.service import _fetch_rows
        from django.db import connection
        qrel = connection.ops.quote_name(relation.db_relation_name)
        _cols, count_rows = _fetch_rows(f"SELECT COUNT(*) FROM {qrel}", [])
        total = int(count_rows[0][0] if count_rows else 0)
        cols, rows = _fetch_rows(f"SELECT * FROM {qrel} LIMIT %s OFFSET %s", [page_size, (page - 1) * page_size])
        return Response(
            {
                "dashboard_slug": slug,
                "relation_slug": relation.slug,
                "total_rows": total,
                "items": [dict(zip(cols, row)) for row in rows],
            }
        )


class DashboardRelationKpisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug: str, relation_slug: str):
        relation = get_object_or_404(SqlView.objects.filter(is_active=True), slug=relation_slug)
        allowed = user_environment_ids(request.user)
        if not relation.environments.filter(id__in=allowed).exists():
            return Response({"detail": "Access denied for this environment."}, status=status.HTTP_403_FORBIDDEN)
        if not relation.db_relation_name:
            return Response({"detail": "SQL view is not deployed yet."}, status=status.HTTP_409_CONFLICT)
        from apps.datahub.service import _fetch_rows
        from django.db import connection
        qrel = connection.ops.quote_name(relation.db_relation_name)
        _cols, rows = _fetch_rows(f"SELECT COUNT(*) FROM {qrel}", [])
        return Response({"dashboard_slug": slug, "relation_slug": relation.slug, "total_rows": int(rows[0][0] if rows else 0)})
