from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("dashboards", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="DashboardNgsiLdSource",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("is_active", models.BooleanField(default=True)),
                ("entity_type", models.CharField(max_length=120)),
                ("tenant", models.CharField(blank=True, max_length=255)),
                ("tenant_header", models.CharField(default="NGSILD-Tenant", max_length=100)),
                ("context_link", models.TextField(blank=True)),
                ("base_url", models.CharField(blank=True, max_length=500)),
                ("auth_url", models.CharField(blank=True, max_length=500)),
                ("client_id", models.CharField(blank=True, max_length=255)),
                ("client_secret", models.CharField(blank=True, max_length=255)),
                ("oauth_scope", models.CharField(blank=True, max_length=255)),
                ("oauth_audience", models.CharField(blank=True, max_length=255)),
                ("request_limit", models.PositiveIntegerField(default=1000)),
                ("cache_ttl_seconds", models.PositiveIntegerField(default=60)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "dashboard",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ngsild_source",
                        to="dashboards.dashboard",
                    ),
                ),
            ],
            options={
                "verbose_name": "Dashboard NGSI-LD source",
                "verbose_name_plural": "Dashboard NGSI-LD sources",
                "ordering": ["dashboard__slug"],
            },
        ),
    ]
