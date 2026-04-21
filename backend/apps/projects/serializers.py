from rest_framework import serializers

from .models import Project, ProjectMedia


class ProjectMediaSerializer(serializers.ModelSerializer):
    type = serializers.CharField(source="media_type")

    class Meta:
        model = ProjectMedia
        fields = ("type", "title", "src", "sort_order")


class ProjectSerializer(serializers.ModelSerializer):
    media = ProjectMediaSerializer(many=True, read_only=True)

    class Meta:
        model = Project
        fields = (
            "id",
            "slug",
            "title",
            "summary",
            "domain",
            "location",
            "role",
            "context",
            "hero_image",
            "technologies",
            "tags",
            "contribution",
            "solution",
            "impacts",
            "media",
            "created_at",
            "updated_at",
        )
