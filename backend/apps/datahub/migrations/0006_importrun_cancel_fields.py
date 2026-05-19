from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("datahub", "0005_importrun_logs"),
    ]

    operations = [
        migrations.AddField(
            model_name="importrun",
            name="cancel_requested",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="importrun",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="importrun",
            name="status",
            field=models.CharField(
                choices=[
                    ("started", "Started"),
                    ("success", "Success"),
                    ("failed", "Failed"),
                    ("cancelled", "Cancelled"),
                ],
                default="started",
                max_length=20,
            ),
        ),
    ]
