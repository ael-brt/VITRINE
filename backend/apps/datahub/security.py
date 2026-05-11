from __future__ import annotations

from django.contrib.auth.models import AnonymousUser

from .models import Environment


def user_is_global_admin(user) -> bool:
    if isinstance(user, AnonymousUser):
        return False
    return bool(user.is_superuser or user.is_staff)


def user_environment_ids(user) -> set[int]:
    if user_is_global_admin(user):
        return set(Environment.objects.values_list("id", flat=True))
    if not getattr(user, "is_authenticated", False):
        return set()
    return set(
        Environment.objects.filter(access_groups__users=user, access_groups__is_active=True)
        .distinct()
        .values_list("id", flat=True)
    )

