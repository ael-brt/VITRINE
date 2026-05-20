from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("datahub", "0006_importrun_cancel_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="Dashboard",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=120, unique=True)),
                ("title", models.CharField(max_length=180)),
                ("description", models.TextField(blank=True)),
                ("is_protected", models.BooleanField(default=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "environments",
                    models.ManyToManyField(blank=True, related_name="dashboards", to="datahub.environment"),
                ),
                (
                    "sql_view",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="dashboards",
                        to="datahub.sqlview",
                    ),
                ),
            ],
            options={"ordering": ["slug"]},
        ),
    ]
