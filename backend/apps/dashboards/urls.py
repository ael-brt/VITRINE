from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DashboardDataView,
    DashboardJoinedView,
    DashboardKpisView,
    DashboardMapView,
    DashboardRelationDataView,
    DashboardRelationKpisView,
    DashboardTimeseriesView,
    DashboardViewSet,
)

router = DefaultRouter()
router.register("", DashboardViewSet, basename="dashboard")

urlpatterns = [
    path("<slug:slug>/data/", DashboardDataView.as_view(), name="dashboard-data"),
    path("<slug:slug>/map/", DashboardMapView.as_view(), name="dashboard-map"),
    path("<slug:slug>/kpis/", DashboardKpisView.as_view(), name="dashboard-kpis"),
    path("<slug:slug>/timeseries/", DashboardTimeseriesView.as_view(), name="dashboard-timeseries"),
    path("<slug:slug>/joined/", DashboardJoinedView.as_view(), name="dashboard-joined"),
    path("<slug:slug>/relations/<slug:relation_slug>/data/", DashboardRelationDataView.as_view(), name="dashboard-relation-data"),
    path("<slug:slug>/relations/<slug:relation_slug>/kpis/", DashboardRelationKpisView.as_view(), name="dashboard-relation-kpis"),
]

urlpatterns += router.urls
