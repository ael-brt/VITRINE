from django.db import migrations
import django.db.models.deletion
from django.db import models


def copy_dashboards_tenants_to_datahub(apps, schema_editor):
    OldTenant = apps.get_model("dashboards", "Tenant")
    NewTenant = apps.get_model("datahub", "Tenant")
    Dashboard = apps.get_model("dashboards", "Dashboard")

    old_to_new: dict[int, int] = {}
    for old in OldTenant.objects.all():
        new, _ = NewTenant.objects.get_or_create(
            slug=old.slug,
            defaults={
                "name": old.name,
                "description": old.description,
                "is_active": old.is_active,
            },
        )
        old_to_new[old.id] = new.id

    for dashboard in Dashboard.objects.all():
        if dashboard.tenant_id in old_to_new:
            dashboard.tenant_id = old_to_new[dashboard.tenant_id]
            dashboard.save(update_fields=["tenant"])


class Migration(migrations.Migration):
    dependencies = [
        ("datahub", "0001_initial"),
        ("dashboards", "0003_backfill_dashboard_tenant"),
    ]

    operations = [
        migrations.AlterField(
            model_name="dashboard",
            name="tenant",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="dashboards", to="datahub.tenant"),
        ),
        migrations.RunPython(copy_dashboards_tenants_to_datahub, migrations.RunPython.noop),
        migrations.DeleteModel(name="Tenant"),
    ]

