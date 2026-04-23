from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.dashboards.models import Dashboard, Tenant
from apps.ngsild.admin import DashboardNgsiLdJoinRuleAdminForm, _source_key_paths

from .client import fetch_entities
from .models import (
    DashboardNgsiLdEntityType,
    DashboardNgsiLdJoinRule,
    DashboardNgsiLdNormalizedEntity,
    DashboardNgsiLdSource,
    DashboardNgsiLdSyncJob,
)
from .service import get_dashboard_data
from .sync import enqueue_due_sync_jobs, run_pending_sync_jobs, sync_source_now


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class NgsiLdServiceTests(TestCase):
    def test_unknown_dashboard_slug_returns_warning_payload(self):
        payload = get_dashboard_data("unknown-dashboard")
        self.assertEqual(payload["dashboard_slug"], "unknown-dashboard")
        self.assertEqual(payload["total_entities"], 0)
        self.assertIn("warning", payload)

    @patch("apps.ngsild.service.fetch_entities")
    def test_admin_configured_source_is_used(self, mock_fetch_entities):
        def _side_effect(entity_type, limit, overrides):
            if entity_type == "TronconDeRoute":
                return [
                    {
                        "id": "urn:ngsi-ld:TronconDeRoute:1",
                        "localisation": {
                            "type": "GeoProperty",
                            "value": {"type": "LineString", "coordinates": [[2.3, 48.8], [2.31, 48.81]]},
                        },
                    }
                ]
            if entity_type == "HereFlow":
                return [
                    {
                        "id": "urn:ngsi-ld:HereFlow:1",
                        "localisation": {
                            "type": "GeoProperty",
                            "value": {"type": "Point", "coordinates": [2.32, 48.82]},
                        },
                    }
                ]
            return []

        mock_fetch_entities.side_effect = _side_effect

        dashboard = Dashboard.objects.create(
            tenant=Tenant.objects.create(slug="tenant-floatingcardata", name="Tenant Floating"),
            slug="floatingcardata",
            title="Floating",
            description="Test",
        )
        source = DashboardNgsiLdSource.objects.create(
            dashboard=dashboard,
            entity_type="TronconDeRoute",
            tenant="tenant-a",
            request_limit=250,
            cache_ttl_seconds=45,
        )
        DashboardNgsiLdEntityType.objects.create(
            source=source,
            entity_type="TronconDeRoute",
            sort_order=1,
        )
        DashboardNgsiLdEntityType.objects.create(
            source=source,
            entity_type="HereFlow",
            sort_order=2,
        )

        payload = get_dashboard_data("floatingcardata")

        self.assertEqual(payload["entity_type"], "TronconDeRoute")
        self.assertEqual(payload["entity_types"], ["TronconDeRoute", "HereFlow"])
        self.assertEqual(payload["total_entities"], 2)
        self.assertEqual(payload["tenant"], "tenant-a")
        self.assertEqual(payload["stats"]["line_count"], 1)
        self.assertEqual(payload["stats"]["point_count"], 1)
        self.assertEqual(payload["counts_by_type"]["TronconDeRoute"], 1)
        self.assertEqual(payload["counts_by_type"]["HereFlow"], 1)
        self.assertEqual(mock_fetch_entities.call_count, 2)


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class NgsiLdSyncTests(TestCase):
    def setUp(self):
        self.dashboard = Dashboard.objects.create(
            tenant=Tenant.objects.create(slug="tenant-ceremap3d", name="Tenant Ceremap3d"),
            slug="ceremap3d",
            title="Ceremap",
            description="Test",
        )
        self.source = DashboardNgsiLdSource.objects.create(
            dashboard=self.dashboard,
            tenant="urn:ngsi-ld:tenant:ceremap3d",
            request_limit=50,
            sync_interval_minutes=10,
            last_synced_at=timezone.now() - timedelta(minutes=30),
            is_sync_enabled=True,
        )
        DashboardNgsiLdEntityType.objects.create(
            source=self.source,
            entity_type="Panneau",
            is_active=True,
            sort_order=1,
        )

    def test_enqueue_due_sync_jobs_creates_pending_jobs(self):
        created = enqueue_due_sync_jobs()
        self.assertEqual(created, 1)
        self.assertEqual(
            DashboardNgsiLdSyncJob.objects.filter(
                source=self.source,
                status=DashboardNgsiLdSyncJob.Status.PENDING,
                entity_type="Panneau",
            ).count(),
            1,
        )

    @patch("apps.ngsild.sync.fetch_entities")
    def test_run_pending_sync_jobs_success(self, mock_fetch_entities):
        mock_fetch_entities.return_value = [
            {
                "id": "urn:ngsi-ld:Panneau:1",
                "segmentId": {"type": "Property", "value": "SEG-001"},
                "scope": "zone-a",
                "modifiedAt": {"type": "DateTime", "value": "2026-04-20T10:00:00Z"},
            }
        ]
        enqueue_due_sync_jobs()

        summary = run_pending_sync_jobs(limit=10)
        self.assertEqual(summary["processed"], 1)
        self.assertEqual(summary["success"], 1)
        self.assertEqual(summary["failed"], 0)

        job = DashboardNgsiLdSyncJob.objects.get(source=self.source, entity_type="Panneau")
        self.assertEqual(job.status, DashboardNgsiLdSyncJob.Status.SUCCESS)
        self.assertEqual(job.records_read, 1)
        self.assertEqual(job.records_upserted, 1)
        from .models import DashboardNgsiLdNormalizedEntity

        entity = DashboardNgsiLdNormalizedEntity.objects.get(
            source=self.source,
            entity_type="Panneau",
            entity_id="urn:ngsi-ld:Panneau:1",
        )
        self.assertEqual(entity.dashboard_slug, "ceremap3d")
        self.assertEqual(entity.tenant, "urn:ngsi-ld:tenant:ceremap3d")
        self.assertEqual(entity.join_key, "SEG-001")
        self.assertEqual(entity.scope, "zone-a")
        self.assertIsNotNone(entity.ngsi_updated_at)

    @patch("apps.ngsild.sync.fetch_entities")
    def test_full_sync_replaces_normalized_entities(self, mock_fetch_entities):
        mock_fetch_entities.side_effect = [
            [{"id": "urn:ngsi-ld:Panneau:1"}, {"id": "urn:ngsi-ld:Panneau:2"}],
            [{"id": "urn:ngsi-ld:Panneau:2"}],
        ]

        first = sync_source_now(self.source, mode=DashboardNgsiLdSource.SyncMode.FULL)
        self.assertEqual(first["success"], 1)

        second = sync_source_now(self.source, mode=DashboardNgsiLdSource.SyncMode.FULL)
        self.assertEqual(second["success"], 1)

        from .models import DashboardNgsiLdNormalizedEntity

        ids = list(
            DashboardNgsiLdNormalizedEntity.objects.filter(source=self.source)
            .order_by("entity_id")
            .values_list("entity_id", flat=True)
        )
        self.assertEqual(ids, ["urn:ngsi-ld:Panneau:2"])


class NgsiLdClientPaginationTests(TestCase):
    @patch("apps.ngsild.client.fetch_access_token", return_value="token")
    @patch("apps.ngsild.client._json_request")
    def test_fetch_entities_uses_offset_fallback_when_no_next_link(self, mock_json_request, _mock_token):
        mock_json_request.side_effect = [
            ([
                {"id": "urn:1"},
                {"id": "urn:2"},
                {"id": "urn:3"},
            ], {}),
            ([
                {"id": "urn:4"},
                {"id": "urn:5"},
            ], {}),
        ]

        entities = fetch_entities(
            entity_type="Panneau",
            limit=5,
            overrides={
                "auth_url": "https://auth.example.test/token",
                "client_id": "client-id",
                "base_url": "https://api.example.test/ngsi-ld/v1",
                "tenant": "urn:ngsi-ld:tenant:ceremap3d",
                "page_limit": 3,
            },
        )

        self.assertEqual([item["id"] for item in entities], ["urn:1", "urn:2", "urn:3", "urn:4", "urn:5"])
        self.assertEqual(mock_json_request.call_count, 2)

        first_call_url = mock_json_request.call_args_list[0].kwargs["url"]
        second_call_url = mock_json_request.call_args_list[1].kwargs["url"]
        self.assertIn("limit=3", first_call_url)
        self.assertIn("offset=0", first_call_url)
        self.assertIn("limit=3", second_call_url)
        self.assertIn("offset=3", second_call_url)


class NgsiLdJoinRuleAdminFormTests(TestCase):
    def setUp(self):
        self.dashboard = Dashboard.objects.create(
            tenant=Tenant.objects.create(slug="tenant-join", name="Tenant Join"),
            slug="join-dashboard",
            title="Join Dashboard",
            description="",
        )
        self.dashboard_right = Dashboard.objects.create(
            tenant=Tenant.objects.create(slug="tenant-join-right", name="Tenant Join Right"),
            slug="join-dashboard-right",
            title="Join Dashboard Right",
            description="",
        )
        self.left_source = DashboardNgsiLdSource.objects.create(dashboard=self.dashboard, tenant="left")
        self.right_source = DashboardNgsiLdSource.objects.create(dashboard=self.dashboard_right, tenant="right")
        DashboardNgsiLdEntityType.objects.create(source=self.left_source, entity_type="Panneau", is_active=True)
        DashboardNgsiLdEntityType.objects.create(source=self.right_source, entity_type="Troncon", is_active=True)

        DashboardNgsiLdNormalizedEntity.objects.create(
            source=self.left_source,
            dashboard_slug=self.dashboard.slug,
            tenant="left",
            entity_type="Panneau",
            entity_id="urn:ngsi-ld:Panneau:1",
            join_key="SEG-001",
            entity_payload={
                "id": "urn:ngsi-ld:Panneau:1",
                "segmentId": {"type": "Property", "value": "SEG-001"},
                "metadata": {"network": {"id": "NET-1"}},
            },
        )

    def test_source_key_paths_include_nested_payload_paths(self):
        paths = _source_key_paths(self.left_source.id, "Panneau")
        self.assertIn("segmentId.value", paths)
        self.assertIn("metadata.network.id", paths)
        self.assertIn("id", paths)

    def test_join_rule_form_accepts_valid_dropdown_values(self):
        form = DashboardNgsiLdJoinRuleAdminForm(
            data={
                "dashboard": str(self.dashboard.id),
                "name": "rule-1",
                "is_active": "on",
                "left_source": str(self.left_source.id),
                "left_entity_type": "Panneau",
                "left_key_path": "segmentId.value",
                "right_source": str(self.right_source.id),
                "right_entity_type": "Troncon",
                "right_key_path": "id",
                "join_kind": DashboardNgsiLdJoinRule.JoinKind.LEFT,
                "description": "",
            }
        )

        self.assertTrue(form.is_valid(), form.errors.as_json())

    def test_join_rule_form_rejects_invalid_key_path(self):
        form = DashboardNgsiLdJoinRuleAdminForm(
            data={
                "dashboard": str(self.dashboard.id),
                "name": "rule-2",
                "is_active": "on",
                "left_source": str(self.left_source.id),
                "left_entity_type": "Panneau",
                "left_key_path": "wrong.path",
                "right_source": str(self.right_source.id),
                "right_entity_type": "Troncon",
                "right_key_path": "id",
                "join_kind": DashboardNgsiLdJoinRule.JoinKind.LEFT,
                "description": "",
            }
        )

        self.assertFalse(form.is_valid())
        self.assertIn("left_key_path", form.errors)
