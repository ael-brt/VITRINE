from django.urls import path

from .views import (
    DashboardDetailView,
    DashboardListView,
    EntityTableListView,
    EntityTableRowsByNameView,
    EntityTableSearchView,
    MediaAssetDetailView,
    MediaAssetFileView,
    MediaAssetListView,
    SqlViewGeoJsonView,
    SqlViewListView,
    SqlViewRowsView,
)

urlpatterns = [
    path("tables/", EntityTableListView.as_view(), name="datahub-tables"),
    path("tables/<str:entity_type>/search/", EntityTableSearchView.as_view(), name="datahub-table-search"),
    path("tables/by-name/<str:table_name>/rows/", EntityTableRowsByNameView.as_view(), name="datahub-table-rows-by-name"),
    path("sqlviews/", SqlViewListView.as_view(), name="datahub-sqlviews"),
    path("sqlviews/<slug:slug>/rows/", SqlViewRowsView.as_view(), name="datahub-sqlview-rows"),
    path("sqlviews/<slug:slug>/geojson/", SqlViewGeoJsonView.as_view(), name="datahub-sqlview-geojson"),
    path("media-assets/", MediaAssetListView.as_view(), name="datahub-media-assets"),
    path("media-assets/<int:asset_id>/", MediaAssetDetailView.as_view(), name="datahub-media-asset-detail"),
    path("media-assets/<int:asset_id>/file/", MediaAssetFileView.as_view(), name="datahub-media-asset-file"),
    path("dashboards/", DashboardListView.as_view(), name="datahub-dashboards"),
    path("dashboards/<slug:slug>/", DashboardDetailView.as_view(), name="datahub-dashboard-detail"),
]
