from rest_framework.response import Response
from rest_framework.views import APIView

from .health import build_health_payload


class HealthCheckView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response(build_health_payload())
