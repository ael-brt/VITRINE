from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0005_dashboardngsildnormalizedentity"),
    ]

    operations = [
        migrations.AddField(
            model_name="dashboardngsildnormalizedentity",
            name="dashboard_slug",
            field=models.CharField(db_index=True, default="", max_length=120),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="dashboardngsildnormalizedentity",
            name="join_key",
            field=models.CharField(blank=True, db_index=True, max_length=255),
        ),
        migrations.AddField(
            model_name="dashboardngsildnormalizedentity",
            name="ngsi_updated_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="dashboardngsildnormalizedentity",
            name="scope",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="dashboardngsildnormalizedentity",
            name="tenant",
            field=models.CharField(blank=True, db_index=True, max_length=255),
        ),
        migrations.AddIndex(
            model_name="dashboardngsildnormalizedentity",
            index=models.Index(fields=["source", "entity_type"], name="ngsild_dash_source__903606_idx"),
        ),
        migrations.AddIndex(
            model_name="dashboardngsildnormalizedentity",
            index=models.Index(fields=["dashboard_slug", "entity_type"], name="ngsild_dash_dashboa_0e06ad_idx"),
        ),
        migrations.AddIndex(
            model_name="dashboardngsildnormalizedentity",
            index=models.Index(fields=["tenant", "entity_type"], name="ngsild_dash_tenant_12e3e3_idx"),
        ),
        migrations.AddIndex(
            model_name="dashboardngsildnormalizedentity",
            index=models.Index(fields=["entity_type", "join_key"], name="ngsild_dash_entity__d1c8b0_idx"),
        ),
        migrations.AddIndex(
            model_name="dashboardngsildnormalizedentity",
            index=models.Index(fields=["entity_type", "ngsi_updated_at"], name="ngsild_dash_entity__5589e4_idx"),
        ),
    ]
