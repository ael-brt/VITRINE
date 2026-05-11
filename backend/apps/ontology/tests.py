from unittest.mock import patch

from django.test import TestCase


class OntologyApiTests(TestCase):
    @patch("apps.ontology.service._load_context_catalog")
    def test_definitions_endpoint_public(self, _mock_catalog_loader):
        response = self.client.get("/api/v1/ontology/definitions/")
        self.assertEqual(response.status_code, 200)

