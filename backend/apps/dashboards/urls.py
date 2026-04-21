from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DashboardDataView,
    DashboardKpisView,
    DashboardMapView,
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
]

urlpatterns += router.urls
