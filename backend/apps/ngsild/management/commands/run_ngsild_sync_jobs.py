from django.core.management.base import BaseCommand

from apps.ngsild.sync import run_pending_sync_jobs


class Command(BaseCommand):
    help = "Run pending NGSI-LD sync jobs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=20,
            help="Maximum number of pending jobs to process.",
        )

    def handle(self, *args, **options):
        summary = run_pending_sync_jobs(limit=options["limit"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Processed={summary['processed']} Success={summary['success']} Failed={summary['failed']}"
            )
        )
