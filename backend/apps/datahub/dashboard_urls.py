from django.urls import path

from .views import (
    DashboardDataView,
    DashboardDetailView,
    DashboardJoinedKpisView,
    DashboardKpisView,
    DashboardListView,
    DashboardMapView,
)

urlpatterns = [
    path("", DashboardListView.as_view(), name="dashboards-list"),
    path("<slug:slug>/", DashboardDetailView.as_view(), name="dashboards-detail"),
    path("<slug:slug>/data/", DashboardDataView.as_view(), name="dashboards-data"),
    path("<slug:slug>/kpis/", DashboardKpisView.as_view(), name="dashboards-kpis"),
    path("<slug:slug>/joined/", DashboardJoinedKpisView.as_view(), name="dashboards-joined"),
    path("<slug:slug>/map/", DashboardMapView.as_view(), name="dashboards-map"),
]
