from django.contrib.auth import authenticate
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.datahub.models import Environment
from apps.datahub.security import user_environment_ids


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        identifier = (
            request.data.get("email")
            or request.data.get("username")
            or request.data.get("identifier")
            or ""
        )
        username = str(identifier).strip()
        password = request.data.get("password", "")
        client_ip = request.META.get("REMOTE_ADDR", "")
        throttle_key = f"accounts:login:attempts:{client_ip}:{username.lower()}"
        max_attempts = 8
        window_seconds = 300

        attempts = int(cache.get(throttle_key, 0) or 0)
        if attempts >= max_attempts:
            return Response(
                {"detail": "Too many login attempts. Try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if not username or not password:
            cache.set(throttle_key, attempts + 1, timeout=window_seconds)
            return Response(
                {"detail": "Email/username and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Allow login by email without changing Django's auth backend.
        if "@" in username:
            user_model = get_user_model()
            matched_user = (
                user_model.objects.filter(email__iexact=username)
                .only("username")
                .first()
            )
            if matched_user is None:
                cache.set(throttle_key, attempts + 1, timeout=window_seconds)
                return Response(
                    {"detail": "Invalid credentials."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            username = matched_user.username

        user = authenticate(request, username=username, password=password)

        if user is None:
            cache.set(throttle_key, attempts + 1, timeout=window_seconds)
            return Response(
                {"detail": "Invalid credentials."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        cache.delete(throttle_key)

        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)

        return Response(
            {
                "token": token.key,
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                },
            }
        )


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = getattr(request, "auth", None)
        if token is not None:
            token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        env_ids = user_environment_ids(user)
        environments = list(
            Environment.objects.filter(id__in=env_ids, is_active=True)
            .order_by("slug")
            .values("id", "slug", "name")
        )
        return Response(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_admin": bool(user.is_staff or user.is_superuser),
                "environments": environments,
            }
        )
