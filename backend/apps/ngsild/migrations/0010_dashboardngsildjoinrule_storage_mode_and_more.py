from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0009_dashboardngsildnormalizedentity_source_entity_type_join_key_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="auto_refresh_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="db_relation_name",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="last_refresh_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="last_refresh_status",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="last_refreshed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="storage_mode",
            field=models.CharField(
                choices=[("live_view", "Live view"), ("materialized_view", "Materialized view")],
                default="live_view",
                max_length=30,
            ),
        ),
    ]
