from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0008_dashboardngsildjoinrule_left_tenant_and_more"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="dashboardngsildnormalizedentity",
            index=models.Index(
                fields=["source", "entity_type", "join_key"],
                name="ngsild_dash_source_join_key_idx",
            ),
        ),
    ]
