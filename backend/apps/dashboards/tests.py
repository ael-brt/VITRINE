from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from apps.datahub.models import DashboardDataset, Environment, EnvironmentAccessGroup, Tenant
from apps.dashboards.models import Dashboard


class DashboardAccessTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="demo", password="demo-pass")
        token, _ = Token.objects.get_or_create(user=self.user)
        self.auth_header = f"Token {token.key}"

        tenant = Tenant.objects.create(slug="tenant-demo", name="Tenant demo")
        env = Environment.objects.create(slug="env-demo", name="Environment demo")
        dashboard = Dashboard.objects.create(tenant=tenant, slug="demo", title="Demo", description="")
        DashboardDataset.objects.create(dashboard=dashboard, environment=env, is_active=True)

    def test_dashboard_list_without_environment_access(self):
        response = self.client.get("/api/v1/dashboards/", HTTP_AUTHORIZATION=self.auth_header)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 0)

    def test_dashboard_list_with_environment_access(self):
        group = EnvironmentAccessGroup.objects.create(name="g1")
        group.users.add(self.user)
        group.environments.add(Environment.objects.get(slug="env-demo"))
        response = self.client.get("/api/v1/dashboards/", HTTP_AUTHORIZATION=self.auth_header)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

