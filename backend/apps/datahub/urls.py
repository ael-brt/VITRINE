from django.urls import path

from .views import EntityTableListView, EntityTableSearchView

urlpatterns = [
    path("tables/", EntityTableListView.as_view(), name="datahub-tables"),
    path("tables/<str:entity_type>/search/", EntityTableSearchView.as_view(), name="datahub-table-search"),
]

