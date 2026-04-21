from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from apps.ngsild.models import DashboardNgsiLdNormalizedEntity, DashboardNgsiLdSource

from .models import Dashboard, Tenant


class DashboardsSmokeTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(username="demo", password="demo-pass")
        token, _ = Token.objects.get_or_create(user=user)
        self.auth_header = f"Token {token.key}"

        self.tenant = Tenant.objects.create(
            slug="tenant-floatingcardata",
            name="Tenant FloatingCarData",
        )
        Dashboard.objects.create(
            tenant=self.tenant,
            slug="floatingcardata",
            title="Dashboard floatingcardata",
            description="Test dashboard",
        )
        self.dashboard = Dashboard.objects.get(slug="floatingcardata")
        self.source = DashboardNgsiLdSource.objects.create(
            dashboard=self.dashboard,
            tenant="urn:ngsi-ld:tenant:floatingcardata",
            is_active=True,
        )

    def test_list_requires_authentication(self):
        response = self.client.get("/api/v1/dashboards/")
        self.assertEqual(response.status_code, 401)

    def test_list_with_token(self):
        response = self.client.get(
            "/api/v1/dashboards/",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response.status_code, 200)

    @patch("apps.dashboards.views.safe_get_dashboard_data")
    def test_dashboard_data_endpoint(self, mock_data):
        mock_data.return_value = (
            {
                "dashboard_slug": "floatingcardata",
                "entity_type": "TronconDeRoute",
                "total_entities": 1,
                "stats": {"line_count": 1, "point_count": 0, "unknown_geometry_count": 0},
                "sample_ids": ["urn:ngsi-ld:TronconDeRoute:1"],
                "items": [],
            },
            None,
        )

        response = self.client.get(
            "/api/v1/dashboards/floatingcardata/data/",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["dashboard_slug"], "floatingcardata")

    @patch("apps.dashboards.views.safe_get_dashboard_data")
    def test_dashboard_data_endpoint_graceful_fallback(self, mock_data):
        mock_data.return_value = (None, "HTTP Error 503: Service Unavailable")

        response = self.client.get(
            "/api/v1/dashboards/floatingcardata/data/",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["dashboard_slug"], "floatingcardata")
        self.assertTrue(body["degraded"])
        self.assertEqual(body["total_entities"], 0)
        self.assertEqual(body["items"], [])

    def test_dashboard_map_endpoint(self):
        DashboardNgsiLdNormalizedEntity.objects.create(
            source=self.source,
            dashboard_slug="floatingcardata",
            tenant="urn:ngsi-ld:tenant:floatingcardata",
            entity_type="TronconDeRoute",
            entity_id="urn:ngsi-ld:TronconDeRoute:1",
            join_key="SEG-001",
            scope="zone-a",
            entity_payload={
                "id": "urn:ngsi-ld:TronconDeRoute:1",
                "localisation": {
                    "type": "GeoProperty",
                    "value": {"type": "LineString", "coordinates": [[2.3, 48.8], [2.31, 48.81]]},
                },
            },
        )
        DashboardNgsiLdNormalizedEntity.objects.create(
            source=self.source,
            dashboard_slug="floatingcardata",
            tenant="urn:ngsi-ld:tenant:floatingcardata",
            entity_type="HERE",
            entity_id="urn:ngsi-ld:HERE:1",
            join_key="SEG-001",
            scope="zone-a",
            entity_payload={"id": "urn:ngsi-ld:HERE:1"},
        )
        response = self.client.get(
            "/api/v1/dashboards/floatingcardata/map/?page=1&page_size=1&type=TronconDeRoute&tenant=urn:ngsi-ld:tenant:floatingcardata",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["dashboard_slug"], "floatingcardata")
        self.assertEqual(body["total_items"], 1)
        self.assertEqual(body["total_rows"], 1)
        self.assertEqual(body["page_size"], 1)
        self.assertEqual(body["items"][0]["join_key"], "SEG-001")

    def test_dashboard_kpis_endpoint(self):
        DashboardNgsiLdNormalizedEntity.objects.create(
            source=self.source,
            dashboard_slug="floatingcardata",
            tenant="urn:ngsi-ld:tenant:floatingcardata",
            entity_type="TronconDeRoute",
            entity_id="urn:ngsi-ld:TronconDeRoute:1",
            join_key="SEG-001",
            entity_payload={"id": "urn:ngsi-ld:TronconDeRoute:1"},
        )
        DashboardNgsiLdNormalizedEntity.objects.create(
            source=self.source,
            dashboard_slug="floatingcardata",
            tenant="urn:ngsi-ld:tenant:floatingcardata",
            entity_type="HERE",
            entity_id="urn:ngsi-ld:HERE:1",
            join_key="SEG-001",
            entity_payload={"id": "urn:ngsi-ld:HERE:1"},
        )
        response = self.client.get(
            "/api/v1/dashboards/floatingcardata/kpis/?tenant=urn:ngsi-ld:tenant:floatingcardata",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total_entities"], 2)
        self.assertEqual(len(body["counts_by_type"]), 2)
        self.assertEqual(body["with_join_key"], 2)
        self.assertEqual(body["tenant"], "urn:ngsi-ld:tenant:floatingcardata")

    def test_dashboard_timeseries_endpoint(self):
        DashboardNgsiLdNormalizedEntity.objects.create(
            source=self.source,
            dashboard_slug="floatingcardata",
            tenant="urn:ngsi-ld:tenant:floatingcardata",
            entity_type="TronconDeRoute",
            entity_id="urn:ngsi-ld:TronconDeRoute:1",
            join_key="SEG-001",
            entity_payload={"id": "urn:ngsi-ld:TronconDeRoute:1"},
        )
        response = self.client.get(
            "/api/v1/dashboards/floatingcardata/timeseries/?days=30&type=TronconDeRoute",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["dashboard_slug"], "floatingcardata")
        self.assertEqual(body["entity_type"], "TronconDeRoute")
        self.assertGreaterEqual(len(body["points"]), 1)
