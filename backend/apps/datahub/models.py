from django.conf import settings
from django.db import models


class Tenant(models.Model):
    slug = models.SlugField(unique=True, max_length=80)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    api_tenant_value = models.CharField(max_length=255, help_text="Tenant value sent in NGSI-LD tenant header.")
    tenant_header = models.CharField(max_length=100, default="NGSILD-Tenant")
    auth_url = models.CharField(max_length=500)
    client_id = models.CharField(max_length=255)
    base_url = models.CharField(max_length=500, help_text="NGSI-LD base URL ending with /ngsi-ld/v1/")
    context_link = models.TextField(blank=True)
    timeout_seconds = models.PositiveIntegerField(default=20)
    page_limit = models.PositiveIntegerField(default=300)
    client_secret_env_key = models.CharField(
        max_length=180,
        blank=True,
        help_text="Optional explicit env var name containing tenant secret (example: NGSILD_CLIENT_SECRET__TENANT_X).",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug


class Environment(models.Model):
    slug = models.SlugField(unique=True, max_length=80)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug


class EnvironmentAccessGroup(models.Model):
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="environment_access_groups",
        blank=True,
    )
    environments = models.ManyToManyField(
        Environment,
        related_name="access_groups",
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class EntityTable(models.Model):
    class ImportMode(models.TextChoices):
        UPSERT = "upsert", "Upsert"
        FULL = "full", "Full"

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="entity_tables")
    environment = models.ForeignKey(Environment, on_delete=models.CASCADE, related_name="entity_tables")
    entity_type = models.CharField(max_length=120)
    table_name = models.CharField(max_length=120, unique=True)
    endpoint_path = models.CharField(max_length=120, default="entities")
    request_limit = models.PositiveIntegerField(default=500)
    import_mode_default = models.CharField(max_length=20, choices=ImportMode.choices, default=ImportMode.UPSERT)
    context_link_override = models.TextField(blank=True)
    extra_query = models.CharField(
        max_length=500,
        blank=True,
        help_text="Optional additional query string fragment, example: q=speed>50",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["entity_type"]
        unique_together = (("tenant", "entity_type"),)

    def __str__(self) -> str:
        return f"{self.tenant.slug}:{self.entity_type} -> {self.table_name}"


class SqlView(models.Model):
    class StorageMode(models.TextChoices):
        VIEW = "view", "View"
        MATERIALIZED_VIEW = "materialized_view", "Materialized view"

    slug = models.SlugField(unique=True, max_length=120)
    name = models.CharField(max_length=150)
    storage_mode = models.CharField(max_length=30, choices=StorageMode.choices, default=StorageMode.VIEW)
    sql_query = models.TextField()
    db_relation_name = models.CharField(max_length=150, unique=True, blank=True)
    environments = models.ManyToManyField(Environment, related_name="sql_views", blank=True)
    is_active = models.BooleanField(default=True)
    last_refresh_at = models.DateTimeField(null=True, blank=True)
    last_refresh_status = models.CharField(max_length=20, blank=True)
    last_refresh_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug


class ImportRun(models.Model):
    class Mode(models.TextChoices):
        UPSERT = "upsert", "Upsert"
        FULL = "full", "Full"

    class Status(models.TextChoices):
        STARTED = "started", "Started"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    entity_table = models.ForeignKey(EntityTable, on_delete=models.CASCADE, related_name="import_runs")
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="import_runs")
    mode = models.CharField(max_length=20, choices=Mode.choices, default=Mode.UPSERT)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.STARTED)
    rows_read = models.PositiveIntegerField(default=0)
    rows_written = models.PositiveIntegerField(default=0)
    rows_deleted = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]


class ImportLog(models.Model):
    class Level(models.TextChoices):
        INFO = "info", "Info"
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"

    import_run = models.ForeignKey(ImportRun, on_delete=models.CASCADE, related_name="logs")
    level = models.CharField(max_length=10, choices=Level.choices, default=Level.INFO)
    code = models.CharField(max_length=80, blank=True)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
