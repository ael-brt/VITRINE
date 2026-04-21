import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.geodata.models import RoadSegment


class Command(BaseCommand):
    help = "Import road segments from a GeoJSON file into Django models."

    def add_arguments(self, parser):
        parser.add_argument("--input", required=True, help="Path to the GeoJSON file")
        parser.add_argument("--source-url", default="", help="Source API url")

    def handle(self, *args, **options):
        input_path = Path(options["input"]).resolve()

        if not input_path.exists():
            raise CommandError(f"File not found: {input_path}")

        payload = json.loads(input_path.read_text(encoding="utf-8"))
        features = payload.get("features", [])
        source_url = options["source_url"] or payload.get("sourceUrl", "")

        imported = 0
        for feature in features:
            feature_id = feature.get("id") or feature.get("properties", {}).get("id")
            if not feature_id:
                continue

            properties = feature.get("properties", {})
            RoadSegment.objects.update_or_create(
                external_id=feature_id,
                defaults={
                    "label": properties.get("label", ""),
                    "segment_type": properties.get("type", ""),
                    "geometry": feature.get("geometry", {}),
                    "source_url": source_url,
                },
            )
            imported += 1

        self.stdout.write(self.style.SUCCESS(f"Imported {imported} road segments"))
