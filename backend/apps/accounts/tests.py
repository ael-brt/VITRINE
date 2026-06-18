from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient


class AuthApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="demo",
            password="demo-pass",
            email="demo@example.com",
        )
        self.csrf_client = APIClient(enforce_csrf_checks=True)

    def test_login_sets_auth_cookie(self):
        response = self.client.post(
            "/api/v1/accounts/login/",
            {"username": "demo", "password": "demo-pass"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["authenticated"])
        self.assertIn("vitrine_auth_token", response.cookies)

    def test_login_with_email_sets_auth_cookie(self):
        response = self.client.post(
            "/api/v1/accounts/login/",
            {"email": "demo@example.com", "password": "demo-pass"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("vitrine_auth_token", response.cookies)

    def test_me_requires_token(self):
        response = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_returns_profile_with_cookie(self):
        token, _ = Token.objects.get_or_create(user=self.user)
        self.client.cookies["vitrine_auth_token"] = token.key
        response = self.client.get("/api/v1/accounts/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "demo")

    def test_logout_revokes_current_token_with_csrf(self):
        token, _ = Token.objects.get_or_create(user=self.user)
        login_response = self.csrf_client.post(
            "/api/v1/accounts/login/",
            {"username": "demo", "password": "demo-pass"},
            content_type="application/json",
        )
        csrf_token = login_response.cookies["csrftoken"].value
        auth_token = login_response.cookies["vitrine_auth_token"].value
        self.csrf_client.cookies["csrftoken"] = csrf_token
        self.csrf_client.cookies["vitrine_auth_token"] = auth_token
        response = self.csrf_client.post(
            "/api/v1/accounts/logout/",
            {},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Token.objects.filter(key=auth_token).exists())
