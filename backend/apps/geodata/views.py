from rest_framework import viewsets

from .models import RoadSegment
from .serializers import RoadSegmentSerializer


class RoadSegmentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = RoadSegment.objects.all()
    serializer_class = RoadSegmentSerializer
    lookup_field = "external_id"
