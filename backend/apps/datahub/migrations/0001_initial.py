from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Environment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=80, unique=True)),
                ("name", models.CharField(max_length=150)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["slug"]},
        ),
        migrations.CreateModel(
            name="Tenant",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=80, unique=True)),
                ("name", models.CharField(max_length=150)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["slug"]},
        ),
        migrations.CreateModel(
            name="EntityTable",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entity_type", models.CharField(max_length=120, unique=True)),
                ("table_name", models.CharField(max_length=120, unique=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("environments", models.ManyToManyField(blank=True, related_name="entity_tables", to="datahub.environment")),
            ],
            options={"ordering": ["entity_type"]},
        ),
        migrations.CreateModel(
            name="EnvironmentAccessGroup",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120, unique=True)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("environments", models.ManyToManyField(blank=True, related_name="access_groups", to="datahub.environment")),
                ("users", models.ManyToManyField(blank=True, related_name="environment_access_groups", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="SqlView",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=120, unique=True)),
                ("name", models.CharField(max_length=150)),
                ("storage_mode", models.CharField(choices=[("view", "View"), ("materialized_view", "Materialized view")], default="view", max_length=30)),
                ("sql_query", models.TextField()),
                ("db_relation_name", models.CharField(blank=True, max_length=150, unique=True)),
                ("is_active", models.BooleanField(default=True)),
                ("last_refresh_at", models.DateTimeField(blank=True, null=True)),
                ("last_refresh_status", models.CharField(blank=True, max_length=20)),
                ("last_refresh_error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("environments", models.ManyToManyField(blank=True, related_name="sql_views", to="datahub.environment")),
            ],
            options={"ordering": ["slug"]},
        ),
        migrations.CreateModel(
            name="ImportRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("mode", models.CharField(choices=[("upsert", "Upsert"), ("full", "Full")], default="upsert", max_length=20)),
                ("status", models.CharField(choices=[("started", "Started"), ("success", "Success"), ("failed", "Failed")], default="started", max_length=20)),
                ("rows_read", models.PositiveIntegerField(default=0)),
                ("rows_written", models.PositiveIntegerField(default=0)),
                ("rows_deleted", models.PositiveIntegerField(default=0)),
                ("error_message", models.TextField(blank=True)),
                ("started_at", models.DateTimeField(auto_now_add=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("entity_table", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="import_runs", to="datahub.entitytable")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="import_runs", to="datahub.tenant")),
            ],
            options={"ordering": ["-started_at"]},
        ),
    ]
