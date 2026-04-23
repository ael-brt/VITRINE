from django import forms
from django.contrib import admin
from django.http import JsonResponse
from django.urls import path
import json

from .client import NgsiLdClientError, fetch_types_metadata
from .models import (
    DashboardNgsiLdEntityType,
    DashboardNgsiLdJoinRule,
    DashboardNgsiLdNormalizedEntity,
    DashboardNgsiLdSource,
    DashboardNgsiLdSyncJob,
)
from .service import build_source_overrides
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

TABLE_JOIN_FIELDS = (
    "id",
    "source_id",
    "dashboard_slug",
    "tenant",
    "entity_type",
    "entity_id",
    "join_key",
    "scope",
    "ngsi_updated_at",
    "ingested_at",
    "updated_at",
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


def _source_tenants(source_id: int | None) -> list[str]:
    if not source_id:
        return []

    values = set(
        DashboardNgsiLdNormalizedEntity.objects.filter(source_id=source_id)
        .exclude(tenant="")
        .values_list("tenant", flat=True)
        .distinct()
    )
    source_tenant = (
        DashboardNgsiLdSource.objects.filter(id=source_id)
        .exclude(tenant="")
        .values_list("tenant", flat=True)
        .first()
    )
    if source_tenant:
        values.add(source_tenant)
    return sorted(value for value in values if value)


def _source_entity_types(source_id: int | None, tenant: str | None = None) -> list[str]:
    if not source_id:
        return []

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
    normalized_qs = DashboardNgsiLdNormalizedEntity.objects.filter(source_id=source_id)
    if tenant:
        normalized_qs = normalized_qs.filter(tenant=tenant)
    values.update(normalized_qs.values_list("entity_type", flat=True).distinct())

    return sorted(value for value in values if value)


def _source_payload_key_paths(
    source_id: int | None,
    entity_type: str | None,
    tenant: str | None = None,
) -> list[str]:
    if not source_id:
        return []

    queryset = DashboardNgsiLdNormalizedEntity.objects.filter(source_id=source_id)
    if tenant:
        queryset = queryset.filter(tenant=tenant)
    if entity_type:
        queryset = queryset.filter(entity_type=entity_type)

    payloads = queryset.values_list("entity_payload", flat=True)[:200]
    values = set(DEFAULT_KEY_PATHS)
    for payload in payloads:
        values.update(_extract_json_paths(payload))

    return sorted(value for value in values if value)


def _source_joinable_fields(
    source_id: int | None,
    entity_type: str | None,
    tenant: str | None = None,
) -> list[tuple[str, str]]:
    if not source_id:
        return []

    payload_paths = _source_payload_key_paths(source_id, entity_type, tenant=tenant)
    choices = [(f"column.{field_name}", f"Colonne table: {field_name}") for field_name in TABLE_JOIN_FIELDS]
    choices.extend((f"payload.{path}", f"Key path payload: {path}") for path in payload_paths)
    return choices


class DashboardNgsiLdJoinRuleAdminForm(forms.ModelForm):
    class Meta:
        model = DashboardNgsiLdJoinRule
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self.fields["left_tenant"] = forms.ChoiceField(required=False, choices=())
        self.fields["right_tenant"] = forms.ChoiceField(required=False, choices=())
        self.fields["left_entity_type"] = forms.ChoiceField(required=True, choices=())
        self.fields["right_entity_type"] = forms.ChoiceField(required=True, choices=())
        self.fields["left_key_path"] = forms.ChoiceField(required=True, choices=())
        self.fields["right_key_path"] = forms.ChoiceField(required=True, choices=())

        left_source_id = self._bound_source_id("left_source", self.instance.left_source_id)
        right_source_id = self._bound_source_id("right_source", self.instance.right_source_id)

        left_tenant = self._bound_value("left_tenant", "")
        right_tenant = self._bound_value("right_tenant", "")
        left_tenants = _source_tenants(left_source_id)
        right_tenants = _source_tenants(right_source_id)
        self.fields["left_tenant"].choices = [("", "Tenant (tous/default)")] + self._choices(left_tenants)
        self.fields["right_tenant"].choices = [("", "Tenant (tous/default)")] + self._choices(right_tenants)
        self.fields["left_tenant"].help_text = "Selectionne un tenant puis clique Rafraichir options."
        self.fields["right_tenant"].help_text = "Selectionne un tenant puis clique Rafraichir options."

        left_types = _source_entity_types(left_source_id, tenant=left_tenant or None)
        right_types = _source_entity_types(right_source_id, tenant=right_tenant or None)
        self.fields["left_entity_type"].choices = self._choices(left_types)
        self.fields["right_entity_type"].choices = self._choices(right_types)

        left_entity_type = self._bound_value("left_entity_type", self.instance.left_entity_type)
        right_entity_type = self._bound_value("right_entity_type", self.instance.right_entity_type)

        left_join_fields = _source_joinable_fields(left_source_id, left_entity_type, tenant=left_tenant or None)
        right_join_fields = _source_joinable_fields(right_source_id, right_entity_type, tenant=right_tenant or None)
        self.fields["left_key_path"].choices = left_join_fields
        self.fields["right_key_path"].choices = right_join_fields
        self.fields["left_key_path"].help_text = (
            "Choisis un champ de table (column.*) ou un key path payload (payload.*)."
        )
        self.fields["right_key_path"].help_text = (
            "Choisis un champ de table (column.*) ou un key path payload (payload.*)."
        )

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
        left_tenant = cleaned.get("left_tenant")
        right_tenant = cleaned.get("right_tenant")

        left_type = cleaned.get("left_entity_type")
        right_type = cleaned.get("right_entity_type")
        left_key_path = cleaned.get("left_key_path")
        right_key_path = cleaned.get("right_key_path")

        if left_source and left_tenant and left_tenant not in _source_tenants(left_source.id):
            self.add_error("left_tenant", "Tenant invalide pour la source gauche.")
        if right_source and right_tenant and right_tenant not in _source_tenants(right_source.id):
            self.add_error("right_tenant", "Tenant invalide pour la source droite.")

        if left_source and left_type not in _source_entity_types(left_source.id, tenant=left_tenant or None):
            self.add_error("left_entity_type", "Type d'entite invalide pour la source gauche.")
        if right_source and right_type not in _source_entity_types(right_source.id, tenant=right_tenant or None):
            self.add_error("right_entity_type", "Type d'entite invalide pour la source droite.")

        if left_source:
            left_allowed = {
                value
                for value, _label in _source_joinable_fields(
                    left_source.id,
                    left_type,
                    tenant=left_tenant or None,
                )
            }
            if left_key_path not in left_allowed:
                self.add_error("left_key_path", "Champ de jointure invalide pour la source/type de gauche.")
        if right_source:
            right_allowed = {
                value
                for value, _label in _source_joinable_fields(
                    right_source.id,
                    right_type,
                    tenant=right_tenant or None,
                )
            }
            if right_key_path not in right_allowed:
                self.add_error("right_key_path", "Champ de jointure invalide pour la source/type de droite.")

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
    fields = (
        "dashboard",
        "name",
        "is_active",
        "join_kind",
        "description",
        "left_source",
        "left_tenant",
        "left_entity_type",
        "left_key_path",
        "right_source",
        "right_tenant",
        "right_entity_type",
        "right_key_path",
    )
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

    class Media:
        js = ("ngsild/join_rule_admin.js",)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path(
                "join-options/",
                self.admin_site.admin_view(self.join_options_view),
                name="ngsild_dashboardngsildjoinrule_join_options",
            ),
        ]
        return custom_urls + urls

    def join_options_view(self, request):
        source_raw = request.GET.get("source_id")
        tenant = (request.GET.get("tenant") or "").strip()
        entity_type = request.GET.get("entity_type") or None
        try:
            source_id = int(source_raw) if source_raw else None
        except (TypeError, ValueError):
            source_id = None

        tenants = _source_tenants(source_id)
        entity_types = _source_entity_types(source_id, tenant=tenant or None)
        joinable_fields = _source_joinable_fields(source_id, entity_type, tenant=tenant or None)
        return JsonResponse(
            {
                "tenants": tenants,
                "entity_types": entity_types,
                "joinable_fields": [{"value": value, "label": label} for value, label in joinable_fields],
            }
        )


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
    change_list_template = "admin/ngsild/normalized_entities_change_list.html"
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

    class Media:
        js = ("ngsild/normalized_entities_admin.js",)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path(
                "types-cascade/",
                self.admin_site.admin_view(self.types_cascade_view),
                name="ngsild_dashboardngsildnormalizedentity_types_cascade",
            ),
        ]
        return custom_urls + urls

    def changelist_view(self, request, extra_context=None):
        source_tenants = {}
        tenant_rows = (
            DashboardNgsiLdNormalizedEntity.objects.exclude(tenant="")
            .values_list("source_id", "tenant")
            .distinct()
        )
        for source_id, tenant in tenant_rows:
            source_tenants.setdefault(source_id, set()).add(tenant)

        source_payload = []
        for source in DashboardNgsiLdSource.objects.select_related("dashboard").order_by("dashboard__slug"):
            tenants = set(source_tenants.get(source.id, set()))
            if source.tenant:
                tenants.add(source.tenant)
            source_payload.append(
                {
                    "id": source.id,
                    "label": f"{source.dashboard.slug} (source #{source.id})",
                    "defaultTenant": source.tenant or "",
                    "tenants": sorted(tenant for tenant in tenants if tenant),
                }
            )

        extra_context = extra_context or {}
        extra_context.update(
            {
                "ngsild_sources": source_payload,
                "ngsild_sources_json": json.dumps(source_payload),
                "ngsild_types_cascade_endpoint": "../types-cascade/",
            }
        )
        return super().changelist_view(request, extra_context=extra_context)

    def types_cascade_view(self, request):
        source_raw = request.GET.get("source_id")
        tenant = (request.GET.get("tenant") or "").strip()
        try:
            source_id = int(source_raw) if source_raw else None
        except (TypeError, ValueError):
            source_id = None

        if not source_id:
            return JsonResponse({"detail": "source_id is required."}, status=400)

        source = (
            DashboardNgsiLdSource.objects.select_related("dashboard")
            .filter(id=source_id)
            .first()
        )
        if not source:
            return JsonResponse({"detail": "Unknown source."}, status=404)

        overrides = build_source_overrides(source)
        if tenant:
            overrides["tenant"] = tenant

        try:
            payload = fetch_types_metadata(overrides=overrides, details=True)
        except NgsiLdClientError as exc:
            return JsonResponse({"detail": str(exc)}, status=502)

        return JsonResponse(
            {
                "source_id": source.id,
                "source_label": f"{source.dashboard.slug} (source #{source.id})",
                "tenant": tenant or source.tenant or "",
                "types": _normalize_types_payload(payload),
            }
        )


def _normalize_types_payload(payload):
    if isinstance(payload, dict):
        if isinstance(payload.get("typeList"), list):
            items = payload["typeList"]
        elif isinstance(payload.get("types"), list):
            items = payload["types"]
        elif isinstance(payload.get("results"), list):
            items = payload["results"]
        else:
            items = [payload]
    elif isinstance(payload, list):
        items = payload
    else:
        items = []

    normalized = []
    for item in items:
        if isinstance(item, str):
            normalized.append({"type": item, "attribute_count": 0, "attributes": []})
            continue
        if not isinstance(item, dict):
            continue

        type_name = (
            item.get("id")
            or item.get("typeName")
            or item.get("entityType")
            or item.get("type")
            or ""
        )
        if not isinstance(type_name, str) or not type_name:
            continue

        raw_attrs = item.get("attrs", item.get("attributes", item.get("attributeNames", [])))
        attributes = []
        if isinstance(raw_attrs, dict):
            attributes = sorted(str(key) for key in raw_attrs.keys() if key)
        elif isinstance(raw_attrs, list):
            for attr in raw_attrs:
                if isinstance(attr, str) and attr:
                    attributes.append(attr)
                elif isinstance(attr, dict):
                    attr_name = attr.get("id") or attr.get("name") or attr.get("attributeName")
                    if isinstance(attr_name, str) and attr_name:
                        attributes.append(attr_name)

        attributes = sorted(set(attributes))
        normalized.append(
            {
                "type": type_name,
                "attribute_count": len(attributes),
                "attributes": attributes,
            }
        )

    normalized.sort(key=lambda item: item["type"])
    return normalized
