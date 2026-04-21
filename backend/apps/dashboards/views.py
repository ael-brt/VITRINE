from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .marts import kpis_mart, map_mart, timeseries_mart
from apps.ngsild.service import safe_get_dashboard_data

from .models import Dashboard
from .serializers import DashboardSerializer


class DashboardViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Dashboard.objects.select_related("tenant").all().order_by("tenant__slug", "slug")
    serializer_class = DashboardSerializer
    lookup_field = "slug"

    def get_queryset(self):
        qs = super().get_queryset()
        tenant_slug = self.request.query_params.get("tenant")
        if tenant_slug:
            qs = qs.filter(tenant__slug=tenant_slug)
        return qs


class DashboardDataView(APIView):
    def get(self, request, slug: str):
        dashboard = get_object_or_404(Dashboard, slug=slug)
        payload, error = safe_get_dashboard_data(slug=dashboard.slug)

        if error:
            return Response(
                {
                    "dashboard_slug": dashboard.slug,
                    "detail": "NGSI-LD provider unavailable, returning empty payload.",
                    "warning": "Upstream NGSI-LD temporarily unavailable. Showing empty data.",
                    "degraded": True,
                    "provider_error": error,
                    "entity_type": None,
                    "entity_types": [],
                    "counts_by_type": {},
                    "generated_at": None,
                    "total_entities": 0,
                    "stats": {"line_count": 0, "point_count": 0, "unknown_geometry_count": 0},
                    "sample_ids": [],
                    "items": [],
                },
                status=status.HTTP_200_OK,
            )

        return Response(payload)


class DashboardMapView(APIView):
    def get(self, request, slug: str):
        dashboard = get_object_or_404(Dashboard, slug=slug)
        entity_type = request.query_params.get("type")
        tenant = request.query_params.get("tenant")
        join_key = request.query_params.get("join_key")
        try:
            page = int(request.query_params.get("page", "1"))
        except Exception:
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", request.query_params.get("limit", "200")))
        except Exception:
            page_size = 200
        payload = map_mart(
            dashboard_slug=dashboard.slug,
            entity_type=entity_type or None,
            tenant=tenant or None,
            join_key=join_key or None,
            page=page,
            page_size=page_size,
        )
        return Response(payload)


class DashboardKpisView(APIView):
    def get(self, request, slug: str):
        dashboard = get_object_or_404(Dashboard, slug=slug)
        entity_type = request.query_params.get("type")
        tenant = request.query_params.get("tenant")
        return Response(
            kpis_mart(
                dashboard_slug=dashboard.slug,
                entity_type=entity_type or None,
                tenant=tenant or None,
            )
        )


class DashboardTimeseriesView(APIView):
    def get(self, request, slug: str):
        dashboard = get_object_or_404(Dashboard, slug=slug)
        entity_type = request.query_params.get("type")
        tenant = request.query_params.get("tenant")
        try:
            days = int(request.query_params.get("days", "30"))
        except Exception:
            days = 30
        payload = timeseries_mart(
            dashboard_slug=dashboard.slug,
            entity_type=entity_type or None,
            tenant=tenant or None,
            days=days,
        )
        return Response(payload)
