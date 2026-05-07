from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0007_dashboardngsildnormalizedentity_sync_run_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="left_tenant",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="dashboardngsildjoinrule",
            name="right_tenant",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
