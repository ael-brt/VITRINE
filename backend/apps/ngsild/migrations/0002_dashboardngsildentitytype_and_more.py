from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="dashboardngsildsource",
            name="entity_type",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.CreateModel(
            name="DashboardNgsiLdEntityType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entity_type", models.CharField(max_length=120)),
                ("is_active", models.BooleanField(default=True)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                (
                    "source",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="entity_types",
                        to="ngsild.dashboardngsildsource",
                    ),
                ),
            ],
            options={
                "verbose_name": "Dashboard NGSI-LD entity type",
                "verbose_name_plural": "Dashboard NGSI-LD entity types",
                "ordering": ["sort_order", "entity_type"],
                "unique_together": {("source", "entity_type")},
            },
        ),
    ]
