from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token


class ProjectsSmokeTests(TestCase):
    def test_list_requires_authentication(self):
        response = self.client.get("/api/v1/projects/")
        self.assertEqual(response.status_code, 401)

    def test_list_with_token(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(username="demo", password="demo-pass")
        token, _ = Token.objects.get_or_create(user=user)

        response = self.client.get(
            "/api/v1/projects/",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(response.status_code, 200)
