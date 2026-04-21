from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0004_dashboardngsildsource_is_sync_enabled_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="DashboardNgsiLdNormalizedEntity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entity_type", models.CharField(max_length=120)),
                ("entity_id", models.CharField(max_length=255)),
                ("entity_payload", models.JSONField(default=dict)),
                ("ingested_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "source",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="normalized_entities",
                        to="ngsild.dashboardngsildsource",
                    ),
                ),
            ],
            options={
                "verbose_name": "Dashboard NGSI-LD normalized entity",
                "verbose_name_plural": "Dashboard NGSI-LD normalized entities",
                "ordering": ["source__dashboard__slug", "entity_type", "entity_id"],
                "unique_together": {("source", "entity_type", "entity_id")},
            },
        ),
    ]
