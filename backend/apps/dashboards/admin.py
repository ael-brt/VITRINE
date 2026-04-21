from django.contrib import admin

from .models import Dashboard, Tenant


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "is_active")
    search_fields = ("slug", "name")
    list_filter = ("is_active",)


@admin.register(Dashboard)
class DashboardAdmin(admin.ModelAdmin):
    list_display = ("slug", "tenant", "title", "is_protected")
    search_fields = ("slug", "title", "tenant__slug", "tenant__name")
    list_filter = ("tenant", "is_protected")
