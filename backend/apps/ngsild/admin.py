from django.contrib import admin

from .models import (
    DashboardNgsiLdEntityType,
    DashboardNgsiLdJoinRule,
    DashboardNgsiLdNormalizedEntity,
    DashboardNgsiLdSource,
    DashboardNgsiLdSyncJob,
)
from .sync import enqueue_sync_jobs_for_source, run_sync_job


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
