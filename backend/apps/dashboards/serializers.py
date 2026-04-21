from rest_framework import serializers

from .models import Dashboard


class DashboardSerializer(serializers.ModelSerializer):
    tenant_slug = serializers.CharField(source="tenant.slug", read_only=True)

    class Meta:
        model = Dashboard
        fields = ("id", "tenant", "tenant_slug", "slug", "title", "description", "is_protected")
