from django.db import models


class DashboardNgsiLdSource(models.Model):
    class SyncMode(models.TextChoices):
        FULL = "full", "Full"
        INCREMENTAL = "incremental", "Incremental"

    dashboard = models.OneToOneField(
        "dashboards.Dashboard",
        on_delete=models.CASCADE,
        related_name="ngsild_source",
    )
    is_active = models.BooleanField(default=True)
    entity_type = models.CharField(max_length=120, blank=True, default="")

    tenant = models.CharField(max_length=255, blank=True)
    tenant_header = models.CharField(max_length=100, default="NGSILD-Tenant")
    context_link = models.TextField(blank=True)

    base_url = models.CharField(max_length=500, blank=True)
    auth_url = models.CharField(max_length=500, blank=True)
    client_id = models.CharField(max_length=255, blank=True)
    client_secret = models.CharField(max_length=255, blank=True)
    oauth_scope = models.CharField(max_length=255, blank=True)
    oauth_audience = models.CharField(max_length=255, blank=True)

    request_limit = models.PositiveIntegerField(default=100)
    cache_ttl_seconds = models.PositiveIntegerField(default=60)
    is_sync_enabled = models.BooleanField(default=True)
    sync_mode = models.CharField(
        max_length=20,
        choices=SyncMode.choices,
        default=SyncMode.INCREMENTAL,
    )
    sync_interval_minutes = models.PositiveIntegerField(default=15)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["dashboard__slug"]
        verbose_name = "Dashboard NGSI-LD source"
        verbose_name_plural = "Dashboard NGSI-LD sources"

    def __str__(self) -> str:
        return f"{self.dashboard.slug} -> {self.entity_type or 'multiple'}"


class DashboardNgsiLdEntityType(models.Model):
    source = models.ForeignKey(
        DashboardNgsiLdSource,
        on_delete=models.CASCADE,
        related_name="entity_types",
    )
    entity_type = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "entity_type"]
        unique_together = ("source", "entity_type")
        verbose_name = "Dashboard NGSI-LD entity type"
        verbose_name_plural = "Dashboard NGSI-LD entity types"

    def __str__(self) -> str:
        return f"{self.source.dashboard.slug}:{self.entity_type}"


class DashboardNgsiLdJoinRule(models.Model):
    class JoinKind(models.TextChoices):
        INNER = "inner", "Inner"
        LEFT = "left", "Left"

    dashboard = models.ForeignKey(
        "dashboards.Dashboard",
        on_delete=models.CASCADE,
        related_name="ngsild_join_rules",
    )
    name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)

    left_source = models.ForeignKey(
        DashboardNgsiLdSource,
        on_delete=models.CASCADE,
        related_name="join_rules_left",
    )
    left_entity_type = models.CharField(max_length=120)
    left_key_path = models.CharField(
        max_length=255,
        help_text="Dot-path in left entity (example: id or relationship.value).",
    )

    right_source = models.ForeignKey(
        DashboardNgsiLdSource,
        on_delete=models.CASCADE,
        related_name="join_rules_right",
    )
    right_entity_type = models.CharField(max_length=120)
    right_key_path = models.CharField(
        max_length=255,
        help_text="Dot-path in right entity (example: id or relationship.value).",
    )

    join_kind = models.CharField(
        max_length=10,
        choices=JoinKind.choices,
        default=JoinKind.LEFT,
    )
    description = models.TextField(blank=True)

    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["dashboard__slug", "name"]
        unique_together = ("dashboard", "name")
        verbose_name = "Dashboard NGSI-LD join rule"
        verbose_name_plural = "Dashboard NGSI-LD join rules"

    def __str__(self) -> str:
        return f"{self.dashboard.slug}:{self.name}"


class DashboardNgsiLdSyncJob(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    class TriggeredBy(models.TextChoices):
        MANUAL = "manual", "Manual"
        SCHEDULE = "schedule", "Schedule"
        API = "api", "API"

    source = models.ForeignKey(
        DashboardNgsiLdSource,
        on_delete=models.CASCADE,
        related_name="sync_jobs",
    )
    entity_type = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    triggered_by = models.CharField(
        max_length=20,
        choices=TriggeredBy.choices,
        default=TriggeredBy.MANUAL,
    )

    records_read = models.PositiveIntegerField(default=0)
    records_upserted = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Dashboard NGSI-LD sync job"
        verbose_name_plural = "Dashboard NGSI-LD sync jobs"

    def __str__(self) -> str:
        scope = self.entity_type or "all-types"
        return f"{self.source.dashboard.slug}:{scope}:{self.status}"


class DashboardNgsiLdNormalizedEntity(models.Model):
    source = models.ForeignKey(
        DashboardNgsiLdSource,
        on_delete=models.CASCADE,
        related_name="normalized_entities",
    )
    dashboard_slug = models.CharField(max_length=120, db_index=True)
    tenant = models.CharField(max_length=255, blank=True, db_index=True)
    entity_type = models.CharField(max_length=120)
    entity_id = models.CharField(max_length=255)
    join_key = models.CharField(max_length=255, blank=True, db_index=True)
    scope = models.CharField(max_length=255, blank=True)
    ngsi_updated_at = models.DateTimeField(null=True, blank=True, db_index=True)
    entity_payload = models.JSONField(default=dict)

    ingested_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["source__dashboard__slug", "entity_type", "entity_id"]
        unique_together = ("source", "entity_type", "entity_id")
        indexes = [
            models.Index(fields=["source", "entity_type"]),
            models.Index(fields=["dashboard_slug", "entity_type"]),
            models.Index(fields=["tenant", "entity_type"]),
            models.Index(fields=["entity_type", "join_key"]),
            models.Index(fields=["entity_type", "ngsi_updated_at"]),
        ]
        verbose_name = "Dashboard NGSI-LD normalized entity"
        verbose_name_plural = "Dashboard NGSI-LD normalized entities"

    def __str__(self) -> str:
        return f"{self.source.dashboard.slug}:{self.entity_type}:{self.entity_id}"
