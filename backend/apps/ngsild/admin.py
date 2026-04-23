from django.contrib import admin
from django import forms

from .models import (
    DashboardNgsiLdEntityType,
    DashboardNgsiLdJoinRule,
    DashboardNgsiLdNormalizedEntity,
    DashboardNgsiLdSource,
    DashboardNgsiLdSyncJob,
)
from .sync import enqueue_sync_jobs_for_source, run_sync_job


DEFAULT_KEY_PATHS = (
    "id",
    "joinKey",
    "joinKey.value",
    "segmentId",
    "segmentId.value",
    "tronconId",
    "tronconId.value",
    "refInId",
    "refInId.value",
    "scope",
    "scope.value",
)


def _extract_json_paths(payload, *, max_depth=4, prefix=""):
    if max_depth <= 0 or not isinstance(payload, dict):
        return set()

    paths = set()
    for key, value in payload.items():
        if not isinstance(key, str) or not key:
            continue

        path = f"{prefix}.{key}" if prefix else key
        paths.add(path)

        if isinstance(value, dict):
            paths.update(_extract_json_paths(value, max_depth=max_depth - 1, prefix=path))

    return paths


def _source_entity_types(source_id: int | None) -> list[str]:
    if not source_id:
        values = set(
            DashboardNgsiLdEntityType.objects.filter(is_active=True).values_list("entity_type", flat=True)
        )
        values.update(
            DashboardNgsiLdSource.objects.exclude(entity_type="").values_list("entity_type", flat=True)
        )
        values.update(
            DashboardNgsiLdNormalizedEntity.objects.values_list("entity_type", flat=True).distinct()
        )
        return sorted(value for value in values if value)

    source = (
        DashboardNgsiLdSource.objects.filter(id=source_id)
        .only("id", "entity_type")
        .first()
    )
    if not source:
        return []

    values = set()
    if source.entity_type:
        values.add(source.entity_type)

    values.update(
        DashboardNgsiLdEntityType.objects.filter(source_id=source_id, is_active=True)
        .values_list("entity_type", flat=True)
    )
    values.update(
        DashboardNgsiLdNormalizedEntity.objects.filter(source_id=source_id)
        .values_list("entity_type", flat=True)
        .distinct()
    )

    return sorted(value for value in values if value)


def _source_key_paths(source_id: int | None, entity_type: str | None) -> list[str]:
    if not source_id:
        return list(DEFAULT_KEY_PATHS)

    queryset = DashboardNgsiLdNormalizedEntity.objects.filter(source_id=source_id)
    if entity_type:
        queryset = queryset.filter(entity_type=entity_type)

    payloads = queryset.values_list("entity_payload", flat=True)[:200]
    values = set(DEFAULT_KEY_PATHS)
    for payload in payloads:
        values.update(_extract_json_paths(payload))

    return sorted(value for value in values if value)


class DashboardNgsiLdJoinRuleAdminForm(forms.ModelForm):
    class Meta:
        model = DashboardNgsiLdJoinRule
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self.fields["left_entity_type"] = forms.ChoiceField(required=True, choices=())
        self.fields["right_entity_type"] = forms.ChoiceField(required=True, choices=())
        self.fields["left_key_path"] = forms.ChoiceField(required=True, choices=())
        self.fields["right_key_path"] = forms.ChoiceField(required=True, choices=())

        left_source_id = self._bound_source_id("left_source", self.instance.left_source_id)
        right_source_id = self._bound_source_id("right_source", self.instance.right_source_id)

        left_types = _source_entity_types(left_source_id)
        right_types = _source_entity_types(right_source_id)
        self.fields["left_entity_type"].choices = self._choices(left_types)
        self.fields["right_entity_type"].choices = self._choices(right_types)

        left_entity_type = self._bound_value("left_entity_type", self.instance.left_entity_type)
        right_entity_type = self._bound_value("right_entity_type", self.instance.right_entity_type)

        left_paths = _source_key_paths(left_source_id, left_entity_type)
        right_paths = _source_key_paths(right_source_id, right_entity_type)
        self.fields["left_key_path"].choices = self._choices(left_paths)
        self.fields["right_key_path"].choices = self._choices(right_paths)
        self.fields["left_key_path"].help_text = "Chemin disponible pour la source/type de gauche."
        self.fields["right_key_path"].help_text = "Chemin disponible pour la source/type de droite."

    def _bound_source_id(self, name: str, fallback: int | None) -> int | None:
        raw = self._bound_value(name, fallback)
        if raw in (None, ""):
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    def _bound_value(self, name: str, fallback):
        if self.is_bound:
            return self.data.get(name, fallback)
        return fallback

    def _choices(self, values: list[str]):
        return [(value, value) for value in values]

    def clean(self):
        cleaned = super().clean()
        left_source = cleaned.get("left_source")
        right_source = cleaned.get("right_source")

        left_type = cleaned.get("left_entity_type")
        right_type = cleaned.get("right_entity_type")
        left_key_path = cleaned.get("left_key_path")
        right_key_path = cleaned.get("right_key_path")

        if left_source and left_type not in _source_entity_types(left_source.id):
            self.add_error("left_entity_type", "Type d'entite invalide pour la source gauche.")
        if right_source and right_type not in _source_entity_types(right_source.id):
            self.add_error("right_entity_type", "Type d'entite invalide pour la source droite.")

        if left_source and left_key_path not in _source_key_paths(left_source.id, left_type):
            self.add_error("left_key_path", "Key path invalide pour la source/type de gauche.")
        if right_source and right_key_path not in _source_key_paths(right_source.id, right_type):
            self.add_error("right_key_path", "Key path invalide pour la source/type de droite.")

        return cleaned


class DashboardNgsiLdEntityTypeInline(admin.TabularInline):
    model = DashboardNgsiLdEntityType
    extra = 1
    fields = ("entity_type", "is_active", "sort_order")


@admin.register(DashboardNgsiLdSource)
class DashboardNgsiLdSourceAdmin(admin.ModelAdmin):
    list_display = (
        "dashboard",
        "active_types_count",
        "tenant",
        "sync_mode",
        "sync_interval_minutes",
        "request_limit",
        "cache_ttl_seconds",
        "is_active",
        "is_sync_enabled",
        "updated_at",
    )
    list_filter = ("is_active", "is_sync_enabled", "sync_mode", "tenant_header")
    search_fields = ("dashboard__slug", "tenant")
    autocomplete_fields = ("dashboard",)
    inlines = [DashboardNgsiLdEntityTypeInline]
    fields = (
        "dashboard",
        "is_active",
        "tenant",
        "tenant_header",
        "context_link",
        "request_limit",
        "cache_ttl_seconds",
        "is_sync_enabled",
        "sync_mode",
        "sync_interval_minutes",
        "last_synced_at",
    )
    readonly_fields = ("last_synced_at",)
    actions = ("enqueue_selected_sources",)
    exclude = (
        "entity_type",
        "base_url",
        "auth_url",
        "client_id",
        "client_secret",
        "oauth_scope",
        "oauth_audience",
    )

    def active_types_count(self, obj: DashboardNgsiLdSource) -> int:
        return obj.entity_types.filter(is_active=True).count()

    active_types_count.short_description = "active types"

    @admin.action(description="Enqueue sync jobs for selected sources")
    def enqueue_selected_sources(self, request, queryset):
        created = 0
        for source in queryset.select_related("dashboard"):
            created += enqueue_sync_jobs_for_source(source)
        self.message_user(request, f"Created {created} pending sync job(s).")


@admin.register(DashboardNgsiLdJoinRule)
class DashboardNgsiLdJoinRuleAdmin(admin.ModelAdmin):
    form = DashboardNgsiLdJoinRuleAdminForm
    list_display = (
        "name",
        "dashboard",
        "join_kind",
        "left_source",
        "right_source",
        "is_active",
        "updated_at",
    )
    list_filter = ("is_active", "join_kind")
    search_fields = ("name", "dashboard__slug", "left_entity_type", "right_entity_type")
    autocomplete_fields = ("dashboard", "left_source", "right_source")


@admin.register(DashboardNgsiLdSyncJob)
class DashboardNgsiLdSyncJobAdmin(admin.ModelAdmin):
    list_display = (
        "source",
        "entity_type",
        "status",
        "triggered_by",
        "records_read",
        "records_upserted",
        "started_at",
        "finished_at",
        "created_at",
    )
    list_filter = ("status", "triggered_by")
    search_fields = ("source__dashboard__slug", "entity_type", "error_message")
    autocomplete_fields = ("source",)
    readonly_fields = (
        "source",
        "entity_type",
        "status",
        "triggered_by",
        "records_read",
        "records_upserted",
        "error_message",
        "started_at",
        "finished_at",
        "created_at",
    )
    actions = ("run_selected_pending_jobs",)

    @admin.action(description="Run selected pending sync jobs now")
    def run_selected_pending_jobs(self, request, queryset):
        processed = 0
        for job in queryset.select_related("source", "source__dashboard"):
            if job.status != DashboardNgsiLdSyncJob.Status.PENDING:
                continue
            run_sync_job(job)
            processed += 1
        self.message_user(request, f"Executed {processed} pending job(s).")


@admin.register(DashboardNgsiLdNormalizedEntity)
class DashboardNgsiLdNormalizedEntityAdmin(admin.ModelAdmin):
    list_display = (
        "source",
        "dashboard_slug",
        "tenant",
        "entity_type",
        "entity_id",
        "join_key",
        "ngsi_updated_at",
        "ingested_at",
        "updated_at",
    )
    list_filter = ("entity_type", "dashboard_slug")
    search_fields = ("entity_id", "entity_type", "dashboard_slug", "tenant", "join_key")
    autocomplete_fields = ("source",)
    readonly_fields = (
        "source",
        "dashboard_slug",
        "tenant",
        "entity_type",
        "entity_id",
        "join_key",
        "scope",
        "ngsi_updated_at",
        "entity_payload",
        "ingested_at",
        "updated_at",
    )
