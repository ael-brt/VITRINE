from django.contrib import admin

from .models import RoadSegment


@admin.register(RoadSegment)
class RoadSegmentAdmin(admin.ModelAdmin):
    list_display = ("external_id", "segment_type", "synced_at")
    search_fields = ("external_id", "label", "segment_type")
