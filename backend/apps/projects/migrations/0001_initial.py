from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Project",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(unique=True)),
                ("title", models.CharField(max_length=255)),
                ("summary", models.TextField()),
                ("domain", models.CharField(max_length=120)),
                ("location", models.CharField(max_length=120)),
                ("role", models.CharField(max_length=255)),
                ("context", models.TextField(blank=True)),
                ("hero_image", models.CharField(blank=True, max_length=255)),
                ("technologies", models.JSONField(blank=True, default=list)),
                ("tags", models.JSONField(blank=True, default=list)),
                ("contribution", models.JSONField(blank=True, default=list)),
                ("solution", models.JSONField(blank=True, default=list)),
                ("impacts", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["title"]},
        ),
        migrations.CreateModel(
            name="ProjectMedia",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("media_type", models.CharField(choices=[("image", "image"), ("video", "video"), ("3d", "3d")], max_length=10)),
                ("title", models.CharField(max_length=255)),
                ("src", models.CharField(blank=True, max_length=255)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="media", to="projects.project")),
            ],
            options={"ordering": ["sort_order", "id"]},
        ),
    ]
