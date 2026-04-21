from django.db import models


class Tenant(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self) -> str:
        return self.slug


class Dashboard(models.Model):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="dashboards")
    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_protected = models.BooleanField(default=True)

    def __str__(self) -> str:
        return f"{self.tenant.slug}/{self.slug}"
