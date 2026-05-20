from __future__ import annotations

from django import forms
from django.contrib import admin, messages
from django.db import connection
from django.urls import reverse
from django.utils.html import format_html
from django.utils.text import slugify

from .models import (
    Dashboard,
    EntityTable,
    Environment,
    EnvironmentAccessGroup,
    ImportLog,
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
)
from .tasks import import_entity_table_task

MAX_ADMIN_IMPORT_LIMIT = 300


class EntityImportForm(forms.Form):
    mode = forms.ChoiceField(choices=ImportRun.Mode.choices, initial=ImportRun.Mode.UPSERT)
    ngsild_limit = forms.IntegerField(min_value=1, initial=500)


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "api_tenant_value", "is_active", "updated_at")
    search_fields = ("slug", "name", "api_tenant_value", "client_id")
    list_filter = ("is_active",)

    def save_model(self, request, obj, form, change):
        obj.page_limit = max(1, min(int(obj.page_limit or MAX_ADMIN_IMPORT_LIMIT), MAX_ADMIN_IMPORT_LIMIT))
        super().save_model(request, obj, form, change)


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


@admin.register(Dashboard)
class DashboardAdmin(admin.ModelAdmin):
    list_display = ("slug", "title", "is_active", "is_protected", "sql_view", "updated_at")
    search_fields = ("slug", "title", "description")
    list_filter = ("is_active", "is_protected")
    filter_horizontal = ("environments",)


@admin.register(EntityTable)
class EntityTableAdmin(admin.ModelAdmin):
    change_form_template = "admin/datahub/entitytable_change_form.html"
    list_display = ("tenant", "entity_type", "environment", "table_name", "import_widget", "entity_count", "is_active", "data_link", "updated_at")
    search_fields = ("tenant__slug", "entity_type", "table_name", "environment__slug")
    list_filter = ("tenant", "environment", "is_active")
    actions = ("ensure_schema", "drop_physical_table")
    autocomplete_fields = ("tenant", "environment")
    fields = (
        "tenant",
        "entity_type",
        "environment",
        "table_name",
        "endpoint_path",
        "import_mode_default",
        "request_limit",
        "context_link_override",
        "extra_query",
        "is_active",
    )

    def _has_running_import(self, entity_table: EntityTable) -> bool:
        return ImportRun.objects.filter(
            entity_table=entity_table,
            status=ImportRun.Status.STARTED,
            finished_at__isnull=True,
        ).exists()

    @admin.display(description="import")
    def import_widget(self, obj: EntityTable):
        run = (
            ImportRun.objects.filter(entity_table=obj, status=ImportRun.Status.STARTED, finished_at__isnull=True)
            .order_by("-started_at")
            .first()
        )
        if not run:
            return format_html('<span style="padding:2px 8px;border-radius:999px;background:#e8f5e9;color:#1b5e20;">Idle</span>')
        return format_html(
            '<span style="padding:2px 8px;border-radius:999px;background:#fff8e1;color:#8d6e63;">Running</span> '
            '<a href="{}">run #{}</a>',
            reverse("admin:datahub_importrun_change", args=[run.id]),
            run.id,
        )

    @admin.display(description="données")
    def data_link(self, obj: EntityTable):
        url = reverse("admin:datahub_entity_data", args=[obj.id])
        return format_html('<a class="button" href="{}">Voir données</a>', url)

    def save_model(self, request, obj, form, change):
        if not obj.table_name:
            obj.table_name = normalize_table_name(obj.entity_type)
        super().save_model(request, obj, form, change)
        ensure_entity_table_schema(obj)

    @admin.display(description="nb entités")
    def entity_count(self, obj: EntityTable):
        if self._has_running_import(obj):
            return "..."
        try:
            if connection.vendor == "postgresql":
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT COALESCE(reltuples, 0)::bigint
                        FROM pg_class
                        WHERE oid = to_regclass(%s)
                        """,
                        [obj.table_name],
                    )
                    row = cursor.fetchone()
                    if row and row[0] is not None:
                        return int(row[0])
            quoted = connection.ops.quote_name(obj.table_name)
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {quoted}")
                return int(cursor.fetchone()[0] or 0)
        except Exception:
            return "-"

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
            path("<int:table_id>/run-import/", self.admin_site.admin_view(self.run_import_view), name="datahub_entity_run_import"),
            path("<int:table_id>/data/", self.admin_site.admin_view(self.data_view), name="datahub_entity_data"),
        ]
        return custom + urls

    def render_change_form(self, request, context, add=False, change=False, form_url="", obj=None):
        if obj and obj.pk:
            context["entity_run_import_url"] = reverse("admin:datahub_entity_run_import", args=[obj.pk])
            context["entity_data_url"] = reverse("admin:datahub_entity_data", args=[obj.pk])
        return super().render_change_form(request, context, add=add, change=change, form_url=form_url, obj=obj)

    def run_import_view(self, request, table_id: int):
        from django.shortcuts import get_object_or_404, redirect

        if request.method != "POST":
            return redirect("admin:datahub_entitytable_change", table_id)

        entity_table = get_object_or_404(EntityTable, id=table_id)
        if self._has_running_import(entity_table):
            self.message_user(
                request,
                "An import is already running for this entity table.",
                level=messages.WARNING,
            )
            return redirect("admin:datahub_entitytable_change", table_id)
        tenant = entity_table.tenant
        mode = entity_table.import_mode_default
        limit = max(1, int(entity_table.request_limit))
        run = ImportRun.objects.create(entity_table=entity_table, tenant=tenant, mode=mode, status=ImportRun.Status.STARTED)
        import_entity_table_task.delay(run_id=run.id, limit=limit)
        self.message_user(
            request,
            f"Import queued in background (run #{run.id}). Check Import Runs for status.",
        )
        return redirect("admin:datahub_entitytable_change", table_id)

    def import_view(self, request, table_id: int):
        from django.shortcuts import get_object_or_404, redirect, render

        entity_table = get_object_or_404(EntityTable, id=table_id)
        if request.method == "POST":
            form = EntityImportForm(request.POST)
            if form.is_valid():
                mode = form.cleaned_data["mode"]
                limit = form.cleaned_data["ngsild_limit"]
                tenant = entity_table.tenant
                if self._has_running_import(entity_table):
                    self.message_user(
                        request,
                        "An import is already running for this entity table.",
                        level=messages.WARNING,
                    )
                    return redirect("admin:datahub_entitytable_change", table_id)
                run = ImportRun.objects.create(entity_table=entity_table, tenant=tenant, mode=mode, status=ImportRun.Status.STARTED)
                import_entity_table_task.delay(run_id=run.id, limit=limit)
                self.message_user(
                    request,
                    f"Import queued in background (run #{run.id}). Check Import Runs for status.",
                )
                return redirect("../../")
        else:
            form = EntityImportForm(initial={"ngsild_limit": max(1, int(entity_table.request_limit))})
        return render(
            request,
            "admin/datahub/import_form.html",
            {"form": form, "entity_table": entity_table, "title": f"Import {entity_table.tenant.slug}/{entity_table.entity_type}"},
        )

    def data_view(self, request, table_id: int):
        from django.shortcuts import get_object_or_404, render

        entity_table = get_object_or_404(EntityTable, id=table_id)
        view_mode = (request.GET.get("view") or "table").strip().lower()
        if view_mode not in {"table", "sources"}:
            view_mode = "table"
        page = max(1, int(request.GET.get("page", "1")))
        page_size = max(1, min(int(request.GET.get("page_size", "100")), 1000))
        offset = (page - 1) * page_size
        q = (request.GET.get("q") or "").strip()

        where_sql = ""
        params: list = []
        if q:
            where_sql = "WHERE entity_id ILIKE %s OR search_text ILIKE %s"
            like = f"%{q}%"
            params = [like, like]

        quoted = connection.ops.quote_name(entity_table.table_name)
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {quoted} {where_sql}", params)
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(
                f"SELECT * FROM {quoted} {where_sql} ORDER BY id DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = cursor.fetchall()
        visible_columns, visible_rows = _project_preview(columns, rows, view_mode=view_mode)

        return render(
            request,
            "admin/datahub/data_preview.html",
            {
                "title": f"Données table {entity_table.table_name}",
                "object_label": f"{entity_table.tenant.slug}/{entity_table.entity_type}",
                "source_name": entity_table.table_name,
                "page": page,
                "page_size": page_size,
                "q": q,
                "total": total,
                "columns": visible_columns,
                "rows": visible_rows,
                "view_mode": view_mode,
                "base_path": reverse("admin:datahub_entity_data", args=[entity_table.id]),
            },
        )

@admin.register(SqlView)
class SqlViewAdmin(admin.ModelAdmin):
    list_display = ("slug", "storage_mode", "is_active", "data_link", "last_refresh_status", "updated_at")
    search_fields = ("slug", "name", "db_relation_name")
    filter_horizontal = ("environments",)
    actions = ("deploy_selected", "refresh_selected")

    @admin.display(description="données")
    def data_link(self, obj: SqlView):
        url = reverse("admin:datahub_sqlview_data", args=[obj.id])
        return format_html('<a class="button" href="{}">Voir données</a>', url)

    def get_urls(self):
        from django.urls import path

        urls = super().get_urls()
        custom = [
            path("<int:view_id>/data/", self.admin_site.admin_view(self.data_view), name="datahub_sqlview_data"),
        ]
        return custom + urls

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

    def data_view(self, request, view_id: int):
        from django.shortcuts import get_object_or_404, render

        sql_view = get_object_or_404(SqlView, id=view_id)
        view_mode = (request.GET.get("view") or "table").strip().lower()
        if view_mode not in {"table", "sources"}:
            view_mode = "table"
        if not sql_view.db_relation_name:
            self.message_user(request, "Deploy the SQL view before previewing data.", level=messages.ERROR)
            return render(
                request,
                "admin/datahub/data_preview.html",
                {
                    "title": f"Données vue {sql_view.slug}",
                    "object_label": sql_view.slug,
                    "source_name": "(not deployed)",
                    "page": 1,
                    "page_size": 100,
                    "q": "",
                    "total": 0,
                    "columns": [],
                    "rows": [],
                    "view_mode": view_mode,
                    "base_path": reverse("admin:datahub_sqlview_data", args=[sql_view.id]),
                },
            )

        page = max(1, int(request.GET.get("page", "1")))
        page_size = max(1, min(int(request.GET.get("page_size", "100")), 1000))
        offset = (page - 1) * page_size
        quoted = connection.ops.quote_name(sql_view.db_relation_name)

        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {quoted}")
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(f"SELECT * FROM {quoted} LIMIT %s OFFSET %s", [page_size, offset])
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = cursor.fetchall()
        visible_columns, visible_rows = _project_preview(columns, rows, view_mode=view_mode)

        return render(
            request,
            "admin/datahub/data_preview.html",
            {
                "title": f"Données vue {sql_view.slug}",
                "object_label": sql_view.slug,
                "source_name": sql_view.db_relation_name,
                "page": page,
                "page_size": page_size,
                "q": "",
                "total": total,
                "columns": visible_columns,
                "rows": visible_rows,
                "view_mode": view_mode,
                "base_path": reverse("admin:datahub_sqlview_data", args=[sql_view.id]),
            },
        )


def _project_preview(columns: list[str], rows: list[tuple], *, view_mode: str) -> tuple[list[str], list[tuple]]:
    core_cols = ["id", "tenant_id", "entity_type", "entity_id"]
    source_cols = ["search_text", "payload_json"]
    if view_mode == "sources":
        preferred = core_cols + source_cols
    else:
        hidden = set(source_cols)
        preferred = core_cols + [col for col in columns if col not in set(core_cols) and col not in hidden]
    selected = [col for col in preferred if col in columns]
    if not selected:
        return columns, rows
    idx_map = [columns.index(col) for col in selected]
    projected = [tuple(row[idx] for idx in idx_map) for row in rows]
    return selected, projected

@admin.register(ImportRun)
class ImportRunAdmin(admin.ModelAdmin):
    list_display = ("entity_table", "tenant", "mode", "status", "cancel_requested", "rows_read", "rows_written", "rows_deleted", "started_at", "finished_at")
    list_filter = ("mode", "status")
    search_fields = ("entity_table__entity_type", "tenant__slug", "error_message")
    readonly_fields = [field.name for field in ImportRun._meta.fields]
    actions = ("request_stop",)

    @admin.action(description="Request stop for selected running imports")
    def request_stop(self, request, queryset):
        running = queryset.filter(status=ImportRun.Status.STARTED, finished_at__isnull=True)
        updated = running.update(cancel_requested=True)
        self.message_user(request, f"Stop requested for {updated} import run(s).")


@admin.register(ImportLog)
class ImportLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "level", "code", "import_run", "short_message")
    list_filter = ("level", "code", "import_run__mode", "import_run__status")
    search_fields = ("code", "message", "import_run__entity_table__entity_type", "import_run__tenant__slug")
    readonly_fields = [field.name for field in ImportLog._meta.fields]

    @admin.display(description="message")
    def short_message(self, obj: ImportLog):
        return (obj.message[:120] + "...") if len(obj.message) > 120 else obj.message
