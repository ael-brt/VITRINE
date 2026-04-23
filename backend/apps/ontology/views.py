from rest_framework.response import Response
from rest_framework.views import APIView

from .service import get_ontology_definitions


class OntologyDefinitionsView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        dashboard_slug = request.query_params.get("dashboard") or None
        tenant = request.query_params.get("tenant") or None
        entity_type = request.query_params.get("entity_type") or None
        payload = get_ontology_definitions(
            dashboard_slug=dashboard_slug,
            tenant=tenant,
            entity_type=entity_type,
        )
        return Response(payload)

