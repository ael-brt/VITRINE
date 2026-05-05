from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0006_dashboardngsildnormalizedentity_dashboard_slug_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="dashboardngsildnormalizedentity",
            name="sync_run_id",
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
        migrations.AddIndex(
            model_name="dashboardngsildnormalizedentity",
            index=models.Index(
                fields=["source", "entity_type", "sync_run_id"],
                name="ngsild_dash_source__run_idx",
            ),
        ),
    ]
