from django.core.management.base import BaseCommand, CommandError

from apps.datahub.client import fetch_entities
from apps.datahub.models import EntityTable, ImportRun, Tenant
from apps.datahub.table_ops import ensure_entity_table_schema, upsert_entities


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


class Command(BaseCommand):
    help = "Import one entity type into its dynamic table."

    def add_arguments(self, parser):
        parser.add_argument("--entity-type", required=True, help="Entity type registered in EntityTable")
        parser.add_argument("--tenant", required=True, help="Tenant slug")
        parser.add_argument("--mode", choices=[ImportRun.Mode.UPSERT, ImportRun.Mode.FULL], default=ImportRun.Mode.UPSERT)
        parser.add_argument("--limit", type=int, default=500)

    def handle(self, *args, **options):
        entity_type = options["entity_type"]
        tenant_slug = options["tenant"]
        mode = options["mode"]
        limit = int(options["limit"])

        try:
            entity_table = EntityTable.objects.get(entity_type=entity_type, is_active=True)
        except EntityTable.DoesNotExist as exc:
            raise CommandError(f"Unknown active entity type: {entity_type}") from exc
        try:
            tenant = Tenant.objects.get(slug=tenant_slug, is_active=True)
        except Tenant.DoesNotExist as exc:
            raise CommandError(f"Unknown active tenant: {tenant_slug}") from exc

        run = ImportRun.objects.create(entity_table=entity_table, tenant=tenant, mode=mode, status=ImportRun.Status.STARTED)
        try:
            ensure_entity_table_schema(entity_table)
            overrides = _build_fetch_overrides(tenant=tenant, entity_table=entity_table)
            entities = fetch_entities(entity_type=entity_type, limit=limit, overrides=overrides)
            written, deleted = upsert_entities(
                entity_table=entity_table,
                tenant=tenant,
                entity_type=entity_type,
                entities=entities,
                mode=mode,
            )
            run.status = ImportRun.Status.SUCCESS
            run.rows_read = len(entities)
            run.rows_written = written
            run.rows_deleted = deleted
            run.save(update_fields=["status", "rows_read", "rows_written", "rows_deleted"])
            self.stdout.write(self.style.SUCCESS(f"Imported {written} row(s), deleted {deleted} row(s)."))
        except Exception as exc:
            run.status = ImportRun.Status.FAILED
            run.error_message = str(exc)
            run.save(update_fields=["status", "error_message"])
            raise CommandError(str(exc)) from exc
