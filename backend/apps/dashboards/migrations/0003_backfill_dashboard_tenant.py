from django.db import migrations, models
import django.db.models.deletion


def _backfill_dashboard_tenant(apps, schema_editor):
    Tenant = apps.get_model("dashboards", "Tenant")
    Dashboard = apps.get_model("dashboards", "Dashboard")

    for dashboard in Dashboard.objects.filter(tenant__isnull=True):
        tenant_slug = (dashboard.slug or "default").strip().lower()[:50] or "default"
        tenant, _ = Tenant.objects.get_or_create(
            slug=tenant_slug,
            defaults={
                "name": f"Tenant {tenant_slug}",
                "description": "Auto-created during dashboard tenant migration.",
                "is_active": True,
            },
        )
        dashboard.tenant = tenant
        dashboard.save(update_fields=["tenant"])


class Migration(migrations.Migration):
    dependencies = [
        ("dashboards", "0002_tenant_and_dashboard_tenant"),
    ]

    operations = [
        migrations.RunPython(_backfill_dashboard_tenant, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="dashboard",
            name="tenant",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="dashboards",
                to="dashboards.tenant",
            ),
        ),
    ]
