from django.contrib import admin

from .models import Project, ProjectMedia


class ProjectMediaInline(admin.TabularInline):
    model = ProjectMedia
    extra = 0


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("title", "domain", "location", "updated_at")
    search_fields = ("title", "summary", "domain", "location")
    prepopulated_fields = {"slug": ("title",)}
    inlines = [ProjectMediaInline]
