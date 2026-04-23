from django.urls import include, path

urlpatterns = [
    path("core/", include("apps.core.urls")),
    path("accounts/", include("apps.accounts.urls")),
    path("projects/", include("apps.projects.urls")),
    path("dashboards/", include("apps.dashboards.urls")),
    path("geodata/", include("apps.geodata.urls")),
    path("ontology/", include("apps.ontology.urls")),
]
