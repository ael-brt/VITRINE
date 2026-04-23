from unittest.mock import patch

from django.test import TestCase

from apps.dashboards.models import Dashboard, Tenant
from apps.ngsild.models import DashboardNgsiLdNormalizedEntity, DashboardNgsiLdSource


class OntologyApiTests(TestCase):
    def setUp(self):
        self.dashboard = Dashboard.objects.create(
            tenant=Tenant.objects.create(slug="tenant-floating", name="Tenant Floating"),
            slug="floatingcardata",
            title="Floating",
            description="",
        )
        self.source = DashboardNgsiLdSource.objects.create(
            dashboard=self.dashboard,
            tenant="urn:ngsi-ld:tenant:floating",
            is_active=True,
        )
        DashboardNgsiLdNormalizedEntity.objects.create(
            source=self.source,
            dashboard_slug="floatingcardata",
            tenant="urn:ngsi-ld:tenant:floating",
            entity_type="HERE",
            entity_id="urn:ngsi-ld:HERE:1",
            entity_payload={
                "id": "urn:ngsi-ld:HERE:1",
                "type": "HERE",
                "shape": {"type": "Property", "value": "polyline"},
                "length": {"type": "Property", "value": 50},
            },
        )

    @patch("apps.ontology.service._load_context_catalog")
    def test_definitions_endpoint_uses_backend_data_and_catalog_enrichment(self, mock_catalog_loader):
        from apps.ontology.service import ContextCatalog

        mock_catalog_loader.return_value = ContextCatalog(
            files=["floatingCarData-context.jsonld"],
            entity_to_context_file={"here": "floatingCarData-context.jsonld"},
            entity_to_uri={"here": "https://semantics.cerema.fr/ontologies/HERE/HERE"},
            context_property_map={
                "floatingCarData-context.jsonld": {
                    "shape": "https://semantics.cerema.fr/ontologies/HERE/shape",
                    "length": "https://semantics.cerema.fr/ontologies/trafic/length",
                }
            },
            global_property_map={
                "shape": "https://semantics.cerema.fr/ontologies/HERE/shape",
                "length": "https://semantics.cerema.fr/ontologies/trafic/length",
            },
            skipped_files=[],
        )

        response = self.client.get("/api/v1/ontology/definitions/?dashboard=floatingcardata")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload["property_links"]), 2)

        terms = {item["term"] for item in payload["property_links"]}
        self.assertIn("shape", terms)
        self.assertIn("length", terms)

        shape_entry = next(item for item in payload["property_links"] if item["term"] == "shape")
        self.assertEqual(shape_entry["source_file"], "floatingCarData-context.jsonld")
        self.assertEqual(shape_entry["entity_term"], "HERE")
        self.assertTrue(shape_entry["is_internal"])

    def test_definitions_endpoint_is_public(self):
        response = self.client.get("/api/v1/ontology/definitions/")
        self.assertEqual(response.status_code, 200)

