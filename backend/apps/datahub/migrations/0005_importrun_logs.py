from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("datahub", "0004_entitytable_import_mode_default"),
    ]

    operations = [
        migrations.CreateModel(
            name="ImportLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("level", models.CharField(choices=[("info", "Info"), ("warning", "Warning"), ("error", "Error")], default="info", max_length=10)),
                ("code", models.CharField(blank=True, max_length=80)),
                ("message", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("import_run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="logs", to="datahub.importrun")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
    ]
