from django.contrib.auth import get_user_model
from django.conf import settings
from django.db import connection
from django.test import TestCase
from django.test import override_settings
from django.urls import reverse
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
import shutil
import tempfile

from .media_storage import normalize_referenced_media_path, resolve_referenced_media_path, resolve_storage_path
from .models import Dashboard, EntityTable, Environment, EnvironmentAccessGroup, MediaAsset, Tenant
from .models import SqlView
from .sql_views import deploy_sql_view


class SqlSandboxAdminTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="demo-pass",
        )
        self.client.force_login(self.user)

        self.tenant = Tenant.objects.create(
            slug="tenant-a",
            name="Tenant A",
            api_tenant_value="tenant-a",
            auth_url="https://example.com/oauth/token",
            client_id="client-a",
            base_url="https://example.com/ngsi-ld/v1/",
        )
        self.environment = Environment.objects.create(
            slug="env-a",
            name="Environment A",
        )
        self.entity_table = EntityTable.objects.create(
            tenant=self.tenant,
            environment=self.environment,
            entity_type="Panneau",
            table_name="ent_sql_sandbox_demo",
        )
        self._create_demo_table()

    def tearDown(self):
        quoted = connection.ops.quote_name(self.entity_table.table_name)
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {quoted}")
        super().tearDown()

    def _create_demo_table(self):
        quoted = connection.ops.quote_name(self.entity_table.table_name)
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                CREATE TABLE {quoted} (
                    id integer primary key,
                    tenant_id integer not null,
                    entity_type varchar(120) not null,
                    entity_id varchar(255) not null,
                    search_text text not null default '',
                    payload_json text null
                )
                """
            )
            cursor.execute(
                f"""
                INSERT INTO {quoted} (id, tenant_id, entity_type, entity_id, search_text, payload_json)
                VALUES (1, %s, %s, %s, %s, %s)
                """,
                [self.tenant.id, "Panneau", "urn:test:1", "label:test", "{}"],
            )

    def test_sql_sandbox_page_renders(self):
        response = self.client.get(reverse("admin:datahub_sqlview_sandbox"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "SQL sandbox")
        self.assertContains(response, self.entity_table.table_name)

    def test_sql_sandbox_executes_allowed_query(self):
        response = self.client.post(
            reverse("admin:datahub_sqlview_sandbox"),
            {
                "sql_query": f"SELECT entity_id, entity_type FROM {self.entity_table.table_name}",
                "row_limit": 25,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "urn:test:1")
        self.assertContains(response, "entity_id")

    def test_sql_sandbox_blocks_unknown_relation(self):
        response = self.client.post(
            reverse("admin:datahub_sqlview_sandbox"),
            {
                "sql_query": "SELECT * FROM forbidden_table",
                "row_limit": 25,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "is not allowed")


class SqlViewDeploymentTests(TestCase):
    def test_deploy_recreates_view_when_columns_change(self):
        view = SqlView.objects.create(
            slug="test-view-cased",
            name="Test View Cased",
            db_relation_name="V_TestViewCased",
            sql_query="SELECT 1 AS localisation_geojson",
        )

        deploy_sql_view(view)

        view.sql_query = "SELECT 1 AS emprise_vitesse"
        deploy_sql_view(view)

        quoted = connection.ops.quote_name(view.db_relation_name)
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT * FROM {quoted}")
            columns = [desc[0] for desc in (cursor.description or [])]

        self.assertEqual(columns, ["emprise_vitesse"])


@override_settings(MEDIA_INTERNAL_URL_PREFIX="", MEDIA_STORAGE_ROOT=tempfile.mkdtemp(prefix="vitrine-media-tests-"))
class MediaAssetApiTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        media_root = getattr(settings, "MEDIA_STORAGE_ROOT", "")
        if media_root:
            shutil.rmtree(media_root, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="user-a",
            email="user-a@example.com",
            password="demo-pass",
        )
        self.other_user = user_model.objects.create_user(
            username="user-b",
            email="user-b@example.com",
            password="demo-pass",
        )
        self.environment = Environment.objects.create(slug="env-media", name="Env Media")
        self.group = EnvironmentAccessGroup.objects.create(name="Media readers")
        self.group.users.add(self.user)
        self.group.environments.add(self.environment)
        self.dashboard = Dashboard.objects.create(
            slug="ceremap3d",
            title="Ceremap3D",
            is_protected=True,
        )
        self.dashboard.environments.add(self.environment)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_media_asset_upload_and_download(self):
        uploaded_file = SimpleUploadedFile("photo-test.jpg", b"fake-image-content", content_type="image/jpeg")
        response = self.client.post(
            reverse("datahub-media-assets"),
            {
                "file": uploaded_file,
                "dashboard_slug": self.dashboard.slug,
                "entity_type": "Panneau",
                "entity_id": "urn:ngsi-ld:Panneau:1",
                "category": MediaAsset.Category.PHOTO,
                "title": "Photo panneau",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)
        asset_id = response.data["id"]
        asset = MediaAsset.objects.get(id=asset_id)
        self.assertTrue(resolve_storage_path(asset.storage_key).exists())

        list_response = self.client.get(
            reverse("datahub-media-assets"),
            {"dashboard_slug": self.dashboard.slug, "entity_type": "Panneau", "entity_id": "urn:ngsi-ld:Panneau:1"},
        )
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["total_items"], 1)

        file_response = self.client.get(reverse("datahub-media-asset-file", args=[asset_id]))
        self.assertEqual(file_response.status_code, 200)
        self.assertEqual(b"".join(file_response.streaming_content), b"fake-image-content")

    def test_media_asset_access_denied_without_environment_access(self):
        asset = MediaAsset.objects.create(
            dashboard=self.dashboard,
            entity_type="Panneau",
            entity_id="urn:ngsi-ld:Panneau:2",
            category=MediaAsset.Category.PHOTO,
            title="Denied asset",
            storage_key="ceremap3d/panneau/demo/file.jpg",
            original_name="file.jpg",
            mime_type="image/jpeg",
            size_bytes=4,
        )
        asset.environments.add(self.environment)

        denied_client = APIClient()
        denied_client.force_authenticate(user=self.other_user)
        response = denied_client.get(reverse("datahub-media-asset-detail", args=[asset.id]))
        self.assertEqual(response.status_code, 403)


@override_settings(
    CEREMAP3D_IMAGE_ROOT=tempfile.mkdtemp(prefix="vitrine-ceremap3d-images-"),
    CEREMAP3D_IMAGE_INTERNAL_URL_PREFIX="",
)
class Ceremap3DReferencedImageTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        image_root = getattr(settings, "CEREMAP3D_IMAGE_ROOT", "")
        if image_root:
            shutil.rmtree(image_root, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="ceremap-user",
            email="ceremap@example.com",
            password="demo-pass",
        )
        self.other_user = user_model.objects.create_user(
            username="ceremap-other",
            email="ceremap-other@example.com",
            password="demo-pass",
        )
        self.environment = Environment.objects.create(slug="env-ceremap", name="Env Ceremap")
        self.group = EnvironmentAccessGroup.objects.create(name="Ceremap readers")
        self.group.users.add(self.user)
        self.group.environments.add(self.environment)
        self.dashboard = Dashboard.objects.create(
            slug="ceremap3d",
            title="Ceremap3D",
            is_protected=True,
        )
        self.dashboard.environments.add(self.environment)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_normalize_referenced_media_path(self):
        self.assertEqual(
            normalize_referenced_media_path('../../photos/panneaux/test.jpg'),
            "photos/panneaux/test.jpg",
        )
        self.assertEqual(
            normalize_referenced_media_path('["../../photos/panneaux/test.jpg"]'),
            "photos/panneaux/test.jpg",
        )
        self.assertEqual(
            normalize_referenced_media_path("../../../../etc/passwd"),
            "etc/passwd",
        )

    def test_ceremap3d_image_endpoint_serves_referenced_file(self):
        relative_path, file_path = resolve_referenced_media_path(
            settings.CEREMAP3D_IMAGE_ROOT,
            "../../photos/panneaux/panneau-1.jpg",
        )
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"panel-image")

        response = self.client.get(
            reverse("datahub-ceremap3d-panel-image"),
            {"path": relative_path},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), b"panel-image")

    def test_ceremap3d_image_endpoint_denies_unauthorized_user(self):
        denied_client = APIClient()
        denied_client.force_authenticate(user=self.other_user)
        response = denied_client.get(
            reverse("datahub-ceremap3d-panel-image"),
            {"path": "photos/panneaux/panneau-1.jpg"},
        )
        self.assertEqual(response.status_code, 403)
