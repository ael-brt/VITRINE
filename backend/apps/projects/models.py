from django.db import models


class Project(models.Model):
    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=255)
    summary = models.TextField()
    domain = models.CharField(max_length=120)
    location = models.CharField(max_length=120)
    role = models.CharField(max_length=255)
    context = models.TextField(blank=True)
    hero_image = models.CharField(max_length=255, blank=True)
    technologies = models.JSONField(default=list, blank=True)
    tags = models.JSONField(default=list, blank=True)
    contribution = models.JSONField(default=list, blank=True)
    solution = models.JSONField(default=list, blank=True)
    impacts = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["title"]

    def __str__(self) -> str:
        return self.title


class ProjectMedia(models.Model):
    MEDIA_TYPES = (
        ("image", "image"),
        ("video", "video"),
        ("3d", "3d"),
    )

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="media")
    media_type = models.CharField(max_length=10, choices=MEDIA_TYPES)
    title = models.CharField(max_length=255)
    src = models.CharField(max_length=255, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.project.slug}:{self.title}"
