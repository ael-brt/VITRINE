from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.urls import reverse

from .models import EntityTable, Environment, Tenant
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
