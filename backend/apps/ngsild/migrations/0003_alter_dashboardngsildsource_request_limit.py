from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("ngsild", "0002_dashboardngsildentitytype_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="dashboardngsildsource",
            name="request_limit",
            field=models.PositiveIntegerField(default=100),
        ),
    ]
