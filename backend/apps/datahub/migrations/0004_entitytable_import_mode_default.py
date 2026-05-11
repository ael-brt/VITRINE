from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("datahub", "0003_entitytable_tenant_environment"),
    ]

    operations = [
        migrations.AddField(
            model_name="entitytable",
            name="import_mode_default",
            field=models.CharField(
                choices=[("upsert", "Upsert"), ("full", "Full")],
                default="upsert",
                max_length=20,
            ),
        ),
    ]

