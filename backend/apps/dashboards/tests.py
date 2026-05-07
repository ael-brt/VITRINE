from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from apps.ngsild.models import (
    DashboardNgsiLdJoinRule,
    DashboardNgsiLdNormalizedEntity,
    DashboardNgsiLdSource,
    DashboardNgsiLdSqlRelation,
)

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

    def test_dashboard_joined_endpoint_left_join(self):
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
            entity_type="TronconDeRoute",
            entity_id="urn:ngsi-ld:TronconDeRoute:2",
            join_key="SEG-002",
            entity_payload={"id": "urn:ngsi-ld:TronconDeRoute:2"},
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

        DashboardNgsiLdJoinRule.objects.create(
            dashboard=self.dashboard,
            name="troncon_here",
            is_active=True,
            join_kind=DashboardNgsiLdJoinRule.JoinKind.LEFT,
            left_source=self.source,
            left_tenant="urn:ngsi-ld:tenant:floatingcardata",
            left_entity_type="TronconDeRoute",
            left_key_path="column.join_key",
            right_source=self.source,
            right_tenant="urn:ngsi-ld:tenant:floatingcardata",
            right_entity_type="HERE",
            right_key_path="column.join_key",
        )

        response = self.client.get(
            "/api/v1/dashboards/floatingcardata/joined/?rule=troncon_here",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["rule"]["name"], "troncon_here")
        self.assertEqual(body["rule"]["join_kind"], "left")
        self.assertTrue(body["scalable_mode"])
        self.assertEqual(body["join_evaluation_mode"], "column-db")
        self.assertEqual(body["matched_items"], 1)
        self.assertEqual(body["unmatched_items"], 1)
        self.assertEqual(body["total_items"], 2)

    def test_dashboard_joined_endpoint_inner_join(self):
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
            entity_type="TronconDeRoute",
            entity_id="urn:ngsi-ld:TronconDeRoute:2",
            join_key="SEG-002",
            entity_payload={"id": "urn:ngsi-ld:TronconDeRoute:2"},
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

        DashboardNgsiLdJoinRule.objects.create(
            dashboard=self.dashboard,
            name="troncon_here_inner",
            is_active=True,
            join_kind=DashboardNgsiLdJoinRule.JoinKind.INNER,
            left_source=self.source,
            left_tenant="urn:ngsi-ld:tenant:floatingcardata",
            left_entity_type="TronconDeRoute",
            left_key_path="column.join_key",
            right_source=self.source,
            right_tenant="urn:ngsi-ld:tenant:floatingcardata",
            right_entity_type="HERE",
            right_key_path="column.join_key",
        )

        response = self.client.get(
            "/api/v1/dashboards/floatingcardata/joined/?rule=troncon_here_inner",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["scalable_mode"])
        self.assertEqual(body["matched_items"], 1)
        self.assertEqual(body["total_items"], 1)
        self.assertTrue(body["items"][0]["matched"])

    def test_dashboard_relation_data_and_kpis_endpoints(self):
        relation = DashboardNgsiLdSqlRelation.objects.create(
            dashboard=self.dashboard,
            name="here_rows",
            slug="here-rows",
            storage_mode=DashboardNgsiLdSqlRelation.StorageMode.LIVE_VIEW,
            sql_query="SELECT entity_id, entity_type, tenant, join_key FROM apps_ngsild_dashboardngsildnormalizedentity WHERE dashboard_slug = 'floatingcardata'",
            is_active=True,
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

        response_data = self.client.get(
            "/api/v1/dashboards/floatingcardata/relations/here-rows/data/",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response_data.status_code, 200)
        body_data = response_data.json()
        self.assertEqual(body_data["relation_slug"], "here-rows")
        self.assertGreaterEqual(body_data["total_rows"], 1)

        response_kpis = self.client.get(
            "/api/v1/dashboards/floatingcardata/relations/here-rows/kpis/",
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(response_kpis.status_code, 200)
        body_kpis = response_kpis.json()
        self.assertEqual(body_kpis["relation_slug"], "here-rows")
        self.assertIn("row_count", body_kpis)
