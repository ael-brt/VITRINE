from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="RoadSegment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("external_id", models.CharField(max_length=255, unique=True)),
                ("label", models.CharField(blank=True, max_length=255)),
                ("segment_type", models.CharField(blank=True, max_length=120)),
                ("geometry", models.JSONField()),
                ("source_url", models.CharField(blank=True, max_length=255)),
                ("synced_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["external_id"]},
        ),
    ]
