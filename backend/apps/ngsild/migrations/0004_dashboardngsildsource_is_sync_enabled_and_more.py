from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("dashboards", "0001_initial"),
        ("ngsild", "0003_alter_dashboardngsildsource_request_limit"),
    ]

    operations = [
        migrations.AddField(
            model_name="dashboardngsildsource",
            name="is_sync_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="dashboardngsildsource",
            name="last_synced_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="dashboardngsildsource",
            name="sync_interval_minutes",
            field=models.PositiveIntegerField(default=15),
        ),
        migrations.AddField(
            model_name="dashboardngsildsource",
            name="sync_mode",
            field=models.CharField(
                choices=[("full", "Full"), ("incremental", "Incremental")],
                default="incremental",
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name="DashboardNgsiLdSyncJob",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entity_type", models.CharField(blank=True, max_length=120)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("running", "Running"),
                            ("success", "Success"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                (
                    "triggered_by",
                    models.CharField(
                        choices=[("manual", "Manual"), ("schedule", "Schedule"), ("api", "API")],
                        default="manual",
                        max_length=20,
                    ),
                ),
                ("records_read", models.PositiveIntegerField(default=0)),
                ("records_upserted", models.PositiveIntegerField(default=0)),
                ("error_message", models.TextField(blank=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "source",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="sync_jobs",
                        to="ngsild.dashboardngsildsource",
                    ),
                ),
            ],
            options={
                "verbose_name": "Dashboard NGSI-LD sync job",
                "verbose_name_plural": "Dashboard NGSI-LD sync jobs",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="DashboardNgsiLdJoinRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("is_active", models.BooleanField(default=True)),
                ("left_entity_type", models.CharField(max_length=120)),
                (
                    "left_key_path",
                    models.CharField(
                        help_text="Dot-path in left entity (example: id or relationship.value).",
                        max_length=255,
                    ),
                ),
                ("right_entity_type", models.CharField(max_length=120)),
                (
                    "right_key_path",
                    models.CharField(
                        help_text="Dot-path in right entity (example: id or relationship.value).",
                        max_length=255,
                    ),
                ),
                (
                    "join_kind",
                    models.CharField(
                        choices=[("inner", "Inner"), ("left", "Left")],
                        default="left",
                        max_length=10,
                    ),
                ),
                ("description", models.TextField(blank=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "dashboard",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="ngsild_join_rules",
                        to="dashboards.dashboard",
                    ),
                ),
                (
                    "left_source",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="join_rules_left",
                        to="ngsild.dashboardngsildsource",
                    ),
                ),
                (
                    "right_source",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="join_rules_right",
                        to="ngsild.dashboardngsildsource",
                    ),
                ),
            ],
            options={
                "verbose_name": "Dashboard NGSI-LD join rule",
                "verbose_name_plural": "Dashboard NGSI-LD join rules",
                "ordering": ["dashboard__slug", "name"],
                "unique_together": {("dashboard", "name")},
            },
        ),
    ]
