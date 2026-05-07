from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("dashboards", "0003_backfill_dashboard_tenant"),
        ("ngsild", "0010_dashboardngsildjoinrule_storage_mode_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="DashboardNgsiLdSqlRelation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("slug", models.SlugField(max_length=120)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "storage_mode",
                    models.CharField(
                        choices=[("live_view", "Live view"), ("materialized_view", "Materialized view")],
                        default="live_view",
                        max_length=30,
                    ),
                ),
                ("auto_refresh_enabled", models.BooleanField(default=False)),
                (
                    "sql_query",
                    models.TextField(
                        help_text="Write a SELECT query only. It will be used to create a DB view or materialized view."
                    ),
                ),
                ("db_relation_name", models.CharField(blank=True, max_length=120)),
                ("last_refreshed_at", models.DateTimeField(blank=True, null=True)),
                ("last_refresh_status", models.CharField(blank=True, max_length=20)),
                ("last_refresh_error", models.TextField(blank=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "dashboard",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="ngsild_sql_relations",
                        to="dashboards.dashboard",
                    ),
                ),
            ],
            options={
                "verbose_name": "Dashboard NGSI-LD SQL relation",
                "verbose_name_plural": "Dashboard NGSI-LD SQL relations",
                "ordering": ["dashboard__slug", "slug"],
                "unique_together": {("dashboard", "slug")},
            },
        ),
    ]
