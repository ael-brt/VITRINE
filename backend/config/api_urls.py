from django.urls import include, path

urlpatterns = [
    path("core/", include("apps.core.urls")),
    path("accounts/", include("apps.accounts.urls")),
    path("datahub/", include("apps.datahub.urls")),
]
