from __future__ import annotations

from django import forms
from django.contrib import admin, messages
from django.db import connection
from django.urls import reverse
from django.utils.html import format_html
from django.utils import timezone
from django.utils.text import slugify

from .client import fetch_entities
from .models import (
    EntityTable,
    Environment,
    EnvironmentAccessGroup,
    ImportRun,
    SqlView,
    Tenant,
)
from .sql_views import SqlViewError, deploy_sql_view, refresh_materialized_view
from .table_ops import (
    DatahubTableError,
    delete_entity_table_physical,
    ensure_entity_table_schema,
    normalize_table_name,
    upsert_entities,
)


class EntityImportForm(forms.Form):
    tenant = forms.ModelChoiceField(queryset=Tenant.objects.filter(is_active=True))
    mode = forms.ChoiceField(choices=ImportRun.Mode.choices, initial=ImportRun.Mode.UPSERT)
    ngsild_limit = forms.IntegerField(min_value=1, max_value=5000, initial=500)


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "api_tenant_value", "is_active", "updated_at")
    search_fields = ("slug", "name", "api_tenant_value", "client_id")
    list_filter = ("is_active",)


@admin.register(Environment)
class EnvironmentAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "is_active", "updated_at")
    search_fields = ("slug", "name")
    list_filter = ("is_active",)


@admin.register(EnvironmentAccessGroup)
class EnvironmentAccessGroupAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "updated_at")
    search_fields = ("name",)
    filter_horizontal = ("users", "environments")


@admin.register(EntityTable)
class EntityTableAdmin(admin.ModelAdmin):
    list_display = ("entity_type", "table_name", "request_limit", "is_active", "import_link", "updated_at")
    search_fields = ("entity_type", "table_name")
    filter_horizontal = ("environments",)
    actions = ("ensure_schema", "drop_physical_table")

    @admin.display(description="import")
    def import_link(self, obj: EntityTable):
        url = reverse("admin:datahub_entity_import", args=[obj.id])
        return format_html('<a class="button" href="{}">Import</a>', url)

    def save_model(self, request, obj, form, change):
        if not obj.table_name:
            obj.table_name = normalize_table_name(obj.entity_type)
        super().save_model(request, obj, form, change)
        ensure_entity_table_schema(obj)

    @admin.action(description="Ensure physical table schema")
    def ensure_schema(self, request, queryset):
        ok = 0
        for entity_table in queryset:
            try:
                ensure_entity_table_schema(entity_table)
                ok += 1
            except Exception as exc:
                self.message_user(request, f"{entity_table.entity_type}: {exc}", level=messages.ERROR)
        self.message_user(request, f"Schema ensured for {ok} table(s).")

    @admin.action(description="Drop selected physical tables (destructive)")
    def drop_physical_table(self, request, queryset):
        dropped = 0
        blocked = 0
        for entity_table in queryset:
            rel = entity_table.table_name
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT count(*)
                    FROM datahub_sqlview
                    WHERE is_active = TRUE AND lower(sql_query) LIKE %s
                    """,
                    [f"%{rel.lower()}%"],
                )
                has_dependency = int(cursor.fetchone()[0] or 0) > 0
            if has_dependency:
                blocked += 1
                self.message_user(
                    request,
                    f"Blocked drop for {entity_table.entity_type}: active SQL views depend on this table.",
                    level=messages.ERROR,
                )
                continue
            delete_entity_table_physical(entity_table)
            dropped += 1
        self.message_user(request, f"Dropped={dropped}, Blocked={blocked}")

    def get_urls(self):
        from django.urls import path

        urls = super().get_urls()
        custom = [
            path("<int:table_id>/import/", self.admin_site.admin_view(self.import_view), name="datahub_entity_import"),
        ]
        return custom + urls

    def import_view(self, request, table_id: int):
        from django.shortcuts import get_object_or_404, redirect, render

        entity_table = get_object_or_404(EntityTable, id=table_id)
        if request.method == "POST":
            form = EntityImportForm(request.POST)
            if form.is_valid():
                tenant = form.cleaned_data["tenant"]
                mode = form.cleaned_data["mode"]
                limit = form.cleaned_data["ngsild_limit"]
                run = ImportRun.objects.create(entity_table=entity_table, tenant=tenant, mode=mode, status=ImportRun.Status.STARTED)
                try:
                    ensure_entity_table_schema(entity_table)
                    overrides = _build_fetch_overrides(tenant=tenant, entity_table=entity_table)
                    entities = fetch_entities(entity_type=entity_table.entity_type, limit=limit, overrides=overrides)
                    written, deleted = upsert_entities(
                        entity_table=entity_table,
                        tenant=tenant,
                        entity_type=entity_table.entity_type,
                        entities=entities,
                        mode=mode,
                    )
                    run.status = ImportRun.Status.SUCCESS
                    run.rows_read = len(entities)
                    run.rows_written = written
                    run.rows_deleted = deleted
                    run.finished_at = timezone.now()
                    run.save(update_fields=["status", "rows_read", "rows_written", "rows_deleted", "finished_at"])
                    self.message_user(request, f"Import success. read={len(entities)} written={written} deleted={deleted}")
                    return redirect("../../")
                except Exception as exc:
                    run.status = ImportRun.Status.FAILED
                    run.error_message = str(exc)
                    run.finished_at = timezone.now()
                    run.save(update_fields=["status", "error_message", "finished_at"])
                    self.message_user(request, f"Import failed: {exc}", level=messages.ERROR)
        else:
            form = EntityImportForm(initial={"ngsild_limit": entity_table.request_limit})
        return render(
            request,
            "admin/datahub/import_form.html",
            {"form": form, "entity_table": entity_table, "title": f"Import {entity_table.entity_type}"},
        )


def _build_fetch_overrides(*, tenant: Tenant, entity_table: EntityTable) -> dict[str, str]:
    overrides: dict[str, str] = {
        "tenant": tenant.api_tenant_value,
        "tenant_header": tenant.tenant_header,
        "auth_url": tenant.auth_url,
        "client_id": tenant.client_id,
        "base_url": tenant.base_url,
        "timeout_seconds": str(tenant.timeout_seconds),
        "page_limit": str(tenant.page_limit),
        "endpoint_path": entity_table.endpoint_path,
    }
    if tenant.context_link:
        overrides["context_link"] = tenant.context_link
    if entity_table.context_link_override:
        overrides["context_link"] = entity_table.context_link_override
    if tenant.client_secret_env_key:
        overrides["client_secret_env_key"] = tenant.client_secret_env_key
    if entity_table.extra_query:
        overrides["extra_query"] = entity_table.extra_query
    return overrides


@admin.register(SqlView)
class SqlViewAdmin(admin.ModelAdmin):
    list_display = ("slug", "storage_mode", "is_active", "last_refresh_status", "updated_at")
    search_fields = ("slug", "name", "db_relation_name")
    filter_horizontal = ("environments",)
    actions = ("deploy_selected", "refresh_selected")

    def save_model(self, request, obj, form, change):
        if not obj.db_relation_name:
            obj.db_relation_name = f"dh_view_{slugify(obj.slug).replace('-', '_')}"[:150]
        super().save_model(request, obj, form, change)
        try:
            deploy_sql_view(obj)
        except SqlViewError as exc:
            self.message_user(request, str(exc), level=messages.ERROR)

    @admin.action(description="Deploy selected SQL views")
    def deploy_selected(self, request, queryset):
        ok = 0
        for view in queryset:
            try:
                deploy_sql_view(view)
                ok += 1
            except Exception as exc:
                self.message_user(request, f"{view.slug}: {exc}", level=messages.ERROR)
        self.message_user(request, f"Deployed {ok} view(s)")

    @admin.action(description="Refresh selected materialized views")
    def refresh_selected(self, request, queryset):
        ok = 0
        for view in queryset:
            try:
                refresh_materialized_view(view)
                ok += 1
            except Exception as exc:
                self.message_user(request, f"{view.slug}: {exc}", level=messages.ERROR)
        self.message_user(request, f"Refreshed {ok} materialized view(s)")

@admin.register(ImportRun)
class ImportRunAdmin(admin.ModelAdmin):
    list_display = ("entity_table", "tenant", "mode", "status", "rows_read", "rows_written", "rows_deleted", "started_at", "finished_at")
    list_filter = ("mode", "status")
    search_fields = ("entity_table__entity_type", "tenant__slug", "error_message")
    readonly_fields = [field.name for field in ImportRun._meta.fields]
