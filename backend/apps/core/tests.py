from django.test import TestCase


class HealthCheckTests(TestCase):
    def test_healthcheck_returns_200(self):
        response = self.client.get("/api/v1/core/health/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("status", payload)
        self.assertIn("services", payload)
        self.assertIn("database", payload["services"])
        self.assertIn("cache", payload["services"])
        self.assertIn("celery", payload["services"])
