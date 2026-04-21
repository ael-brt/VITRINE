from rest_framework import viewsets

from .models import Project
from .serializers import ProjectSerializer


class ProjectViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Project.objects.prefetch_related("media").all()
    serializer_class = ProjectSerializer
    lookup_field = "slug"
