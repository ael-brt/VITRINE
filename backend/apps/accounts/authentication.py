from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import exceptions
from rest_framework.authentication import CSRFCheck
from rest_framework.authentication import TokenAuthentication


class ExpiringTokenAuthentication(TokenAuthentication):
    def enforce_csrf(self, request):
        check = CSRFCheck(lambda _request: None)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f"CSRF Failed: {reason}")

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

    def authenticate(self, request):
        header_auth = super().authenticate(request)
        if header_auth is not None:
            return header_auth

        cookie_name = getattr(settings, "AUTH_TOKEN_COOKIE_NAME", "vitrine_auth_token")
        token_key = request.COOKIES.get(cookie_name)
        if not token_key:
            return None

        user, token = self.authenticate_credentials(token_key)
        if request.method not in ("GET", "HEAD", "OPTIONS", "TRACE"):
            self.enforce_csrf(request)
        return user, token
