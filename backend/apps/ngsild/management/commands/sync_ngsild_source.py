from django.core.management.base import BaseCommand, CommandError

from apps.ngsild.models import DashboardNgsiLdSource, DashboardNgsiLdSyncJob
from apps.ngsild.sync import sync_source_now


class Command(BaseCommand):
    help = "Sync a NGSI-LD source immediately by dashboard slug."

    def add_arguments(self, parser):
        parser.add_argument("--dashboard", required=True, help="Dashboard slug")
        parser.add_argument(
            "--mode",
            choices=[DashboardNgsiLdSource.SyncMode.FULL, DashboardNgsiLdSource.SyncMode.INCREMENTAL],
            default=DashboardNgsiLdSource.SyncMode.INCREMENTAL,
            help="Sync mode for this run only.",
        )

    def handle(self, *args, **options):
        slug = options["dashboard"]
        try:
            source = DashboardNgsiLdSource.objects.select_related("dashboard").get(
                dashboard__slug=slug,
                is_active=True,
            )
        except DashboardNgsiLdSource.DoesNotExist as exc:
            raise CommandError(f"No active NGSI-LD source found for dashboard '{slug}'.") from exc

        summary = sync_source_now(
            source,
            mode=options["mode"],
            triggered_by=DashboardNgsiLdSyncJob.TriggeredBy.MANUAL,
        )
        self.stdout.write(
            self.style.SUCCESS(
                "Created={created} Processed={processed} Success={success} Failed={failed}".format(**summary)
            )
        )
