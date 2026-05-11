from django.db import models


class Dashboard(models.Model):
    tenant = models.ForeignKey("datahub.Tenant", on_delete=models.CASCADE, related_name="dashboards")
    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_protected = models.BooleanField(default=True)

    def __str__(self) -> str:
        return f"{self.tenant.slug}/{self.slug}"
