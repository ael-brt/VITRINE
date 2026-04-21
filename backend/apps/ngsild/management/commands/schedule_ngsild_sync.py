from django.core.management.base import BaseCommand

from apps.ngsild.sync import enqueue_due_sync_jobs


class Command(BaseCommand):
    help = "Create pending NGSI-LD sync jobs for due sources."

    def handle(self, *args, **options):
        created = enqueue_due_sync_jobs()
        self.stdout.write(self.style.SUCCESS(f"Created pending jobs: {created}"))
