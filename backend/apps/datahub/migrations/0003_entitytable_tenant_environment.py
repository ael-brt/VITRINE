from django.db import migrations, models
import django.db.models.deletion


def _backfill_entitytable_tenant_environment(apps, schema_editor):
    Tenant = apps.get_model("datahub", "Tenant")
    Environment = apps.get_model("datahub", "Environment")
    EntityTable = apps.get_model("datahub", "EntityTable")

    tenant = Tenant.objects.order_by("id").first()
    if tenant is None:
        tenant = Tenant.objects.create(
            slug="default-tenant",
            name="Default tenant",
            api_tenant_value="default-tenant",
            tenant_header="NGSILD-Tenant",
            auth_url="http://placeholder.invalid/token",
            client_id="placeholder",
            base_url="http://placeholder.invalid/ngsi-ld/v1/",
        )

    environment = Environment.objects.order_by("id").first()
    if environment is None:
        environment = Environment.objects.create(
            slug="default-env",
            name="Default environment",
        )

    EntityTable.objects.filter(tenant__isnull=True).update(tenant=tenant)
    EntityTable.objects.filter(environment__isnull=True).update(environment=environment)


class Migration(migrations.Migration):
    dependencies = [
        ("datahub", "0002_tenant_entitytable_api_config"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="entitytable",
            name="environments",
        ),
        migrations.AlterField(
            model_name="entitytable",
            name="entity_type",
            field=models.CharField(max_length=120),
        ),
        migrations.AddField(
            model_name="entitytable",
            name="environment",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="entity_tables", to="datahub.environment"),
        ),
        migrations.AddField(
            model_name="entitytable",
            name="tenant",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="entity_tables", to="datahub.tenant"),
        ),
        migrations.RunPython(_backfill_entitytable_tenant_environment, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="entitytable",
            name="environment",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="entity_tables", to="datahub.environment"),
        ),
        migrations.AlterField(
            model_name="entitytable",
            name="tenant",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="entity_tables", to="datahub.tenant"),
        ),
        migrations.AlterUniqueTogether(
            name="entitytable",
            unique_together={("tenant", "entity_type")},
        ),
    ]
