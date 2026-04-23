from django.urls import path

from .views import OntologyDefinitionsView

urlpatterns = [
    path("definitions/", OntologyDefinitionsView.as_view(), name="ontology-definitions"),
]

