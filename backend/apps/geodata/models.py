from django.db import models


class RoadSegment(models.Model):
    external_id = models.CharField(max_length=255, unique=True)
    label = models.CharField(max_length=255, blank=True)
    segment_type = models.CharField(max_length=120, blank=True)
    geometry = models.JSONField()
    source_url = models.CharField(max_length=255, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["external_id"]

    def __str__(self) -> str:
        return self.external_id
