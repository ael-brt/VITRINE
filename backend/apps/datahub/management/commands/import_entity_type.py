from django.core.management.base import BaseCommand, CommandError

from apps.datahub.import_service import execute_import_run
from apps.datahub.models import EntityTable, ImportRun, Tenant
from apps.datahub.tasks import import_entity_table_task


class Command(BaseCommand):
    help = "Import one entity type into its dynamic table."

    def add_arguments(self, parser):
        parser.add_argument("--entity-type", required=True, help="Entity type registered in EntityTable")
        parser.add_argument("--tenant", required=True, help="Tenant slug")
        parser.add_argument("--mode", choices=[ImportRun.Mode.UPSERT, ImportRun.Mode.FULL], default=ImportRun.Mode.UPSERT)
        parser.add_argument("--limit", type=int, default=500)
        parser.add_argument("--async", action="store_true", dest="run_async", help="Queue import in Celery background worker.")

    def handle(self, *args, **options):
        entity_type = options["entity_type"]
        tenant_slug = options["tenant"]
        mode = options["mode"]
        limit = int(options["limit"])
        run_async = bool(options["run_async"])

        try:
            tenant = Tenant.objects.get(slug=tenant_slug, is_active=True)
        except Tenant.DoesNotExist as exc:
            raise CommandError(f"Unknown active tenant: {tenant_slug}") from exc
        try:
            entity_table = EntityTable.objects.get(entity_type=entity_type, tenant=tenant, is_active=True)
        except EntityTable.DoesNotExist as exc:
            raise CommandError(f"Unknown active entity type '{entity_type}' for tenant '{tenant_slug}'.") from exc

        run = ImportRun.objects.create(entity_table=entity_table, tenant=tenant, mode=mode, status=ImportRun.Status.STARTED)
        if run_async:
            import_entity_table_task.delay(run_id=run.id, limit=limit)
            self.stdout.write(self.style.SUCCESS(f"Queued import run #{run.id} in background worker."))
            return

        try:
            run = execute_import_run(run_id=run.id, limit=limit)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Imported {run.rows_written} row(s), deleted {run.rows_deleted} row(s)."
                )
            )
        except Exception as exc:
            raise CommandError(str(exc)) from exc
