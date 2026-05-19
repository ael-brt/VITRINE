from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import exceptions
from rest_framework.authentication import TokenAuthentication


class ExpiringTokenAuthentication(TokenAuthentication):
    def authenticate_credentials(self, key):
        user_auth_tuple = super().authenticate_credentials(key)
        user, token = user_auth_tuple
        ttl_seconds = int(getattr(settings, "AUTH_TOKEN_TTL_SECONDS", 86400))
        if ttl_seconds > 0:
            expires_at = token.created + timedelta(seconds=ttl_seconds)
            if timezone.now() >= expires_at:
                token.delete()
                raise exceptions.AuthenticationFailed("Token expired.")
        return user, token
