from django.contrib.auth import authenticate
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        identifier = (
            request.data.get("email")
            or request.data.get("username")
            or request.data.get("identifier")
            or ""
        )
        username = str(identifier).strip()
        password = request.data.get("password", "")

        if not username or not password:
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
                return Response(
                    {"detail": "Invalid credentials."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            username = matched_user.username

        user = authenticate(request, username=username, password=password)

        if user is None:
            return Response(
                {"detail": "Invalid credentials."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        token, _ = Token.objects.get_or_create(user=user)

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
        return Response(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
            }
        )
