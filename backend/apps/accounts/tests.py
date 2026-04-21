from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token


class AuthApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="demo",
            password="demo-pass",
            email="demo@example.com",
        )

    def test_login_returns_token(self):
        response = self.client.post(
            "/api/v1/accounts/login/",
            {"username": "demo", "password": "demo-pass"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("token", response.json())

    def test_login_with_email_returns_token(self):
        response = self.client.post(
            "/api/v1/accounts/login/",
            {"email": "demo@example.com", "password": "demo-pass"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("token", response.json())

    def test_me_requires_token(self):
        response = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_returns_profile_with_token(self):
        token, _ = Token.objects.get_or_create(user=self.user)
        response = self.client.get(
            "/api/v1/accounts/me/",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "demo")

    def test_logout_revokes_current_token(self):
        token, _ = Token.objects.get_or_create(user=self.user)
        response = self.client.post(
            "/api/v1/accounts/logout/",
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Token.objects.filter(key=token.key).exists())
