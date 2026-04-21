from rest_framework import serializers

from .models import RoadSegment


class RoadSegmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoadSegment
        fields = (
            "id",
            "external_id",
            "label",
            "segment_type",
            "geometry",
            "source_url",
            "synced_at",
        )
