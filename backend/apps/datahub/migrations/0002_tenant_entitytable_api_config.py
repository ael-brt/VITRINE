from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("datahub", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenant",
            name="api_tenant_value",
            field=models.CharField(default="", max_length=255, help_text="Tenant value sent in NGSI-LD tenant header."),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="tenant",
            name="auth_url",
            field=models.CharField(default="", max_length=500),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="tenant",
            name="base_url",
            field=models.CharField(default="", help_text="NGSI-LD base URL ending with /ngsi-ld/v1/", max_length=500),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="tenant",
            name="client_id",
            field=models.CharField(default="", max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="tenant",
            name="client_secret_env_key",
            field=models.CharField(blank=True, help_text="Optional explicit env var name containing tenant secret (example: NGSILD_CLIENT_SECRET__TENANT_X).", max_length=180),
        ),
        migrations.AddField(
            model_name="tenant",
            name="context_link",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="tenant",
            name="page_limit",
            field=models.PositiveIntegerField(default=300),
        ),
        migrations.AddField(
            model_name="tenant",
            name="tenant_header",
            field=models.CharField(default="NGSILD-Tenant", max_length=100),
        ),
        migrations.AddField(
            model_name="tenant",
            name="timeout_seconds",
            field=models.PositiveIntegerField(default=20),
        ),
        migrations.AddField(
            model_name="entitytable",
            name="context_link_override",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="entitytable",
            name="endpoint_path",
            field=models.CharField(default="entities", max_length=120),
        ),
        migrations.AddField(
            model_name="entitytable",
            name="extra_query",
            field=models.CharField(blank=True, help_text="Optional additional query string fragment, example: q=speed>50", max_length=500),
        ),
        migrations.AddField(
            model_name="entitytable",
            name="request_limit",
            field=models.PositiveIntegerField(default=500),
        ),
    ]

