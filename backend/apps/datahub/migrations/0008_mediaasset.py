from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("datahub", "0007_dashboard"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="MediaAsset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entity_type", models.CharField(blank=True, max_length=120)),
                ("entity_id", models.CharField(blank=True, max_length=255)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("photo", "Photo"),
                            ("video", "Video"),
                            ("document", "Document"),
                            ("csv", "CSV"),
                            ("symbology", "Symbology"),
                            ("other", "Other"),
                        ],
                        default="other",
                        max_length=20,
                    ),
                ),
                ("title", models.CharField(blank=True, max_length=180)),
                ("description", models.TextField(blank=True)),
                ("storage_key", models.CharField(max_length=500, unique=True)),
                ("original_name", models.CharField(max_length=255)),
                ("mime_type", models.CharField(blank=True, max_length=150)),
                ("size_bytes", models.PositiveBigIntegerField(default=0)),
                ("checksum_sha256", models.CharField(blank=True, max_length=64)),
                ("is_public", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "dashboard",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="media_assets",
                        to="datahub.dashboard",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="uploaded_media_assets",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "environments",
                    models.ManyToManyField(blank=True, related_name="media_assets", to="datahub.environment"),
                ),
            ],
            options={
                "ordering": ["dashboard__slug", "entity_type", "category", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="mediaasset",
            index=models.Index(fields=["dashboard", "entity_type", "entity_id", "category"], name="datahub_med_dashbo_418dc7_idx"),
        ),
        migrations.AddIndex(
            model_name="mediaasset",
            index=models.Index(fields=["entity_type", "entity_id"], name="datahub_med_entity__49e420_idx"),
        ),
        migrations.AddIndex(
            model_name="mediaasset",
            index=models.Index(fields=["category"], name="datahub_med_categor_1c4d55_idx"),
        ),
    ]
