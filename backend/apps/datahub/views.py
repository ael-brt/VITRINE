from __future__ import annotations

from django.db import connection
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EntityTable
from .security import user_environment_ids


def _q(name: str) -> str:
    return connection.ops.quote_name(name)


class EntityTableListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        env_ids = user_environment_ids(request.user)
        qs = EntityTable.objects.filter(is_active=True, environments__id__in=env_ids).distinct().order_by("entity_type")
        items = [
            {
                "id": row.id,
                "entity_type": row.entity_type,
                "table_name": row.table_name,
                "environments": list(row.environments.values_list("slug", flat=True)),
            }
            for row in qs
        ]
        return Response({"total_items": len(items), "items": items})


class EntityTableSearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, entity_type: str):
        table = get_object_or_404(EntityTable.objects.filter(is_active=True), entity_type=entity_type)
        env_ids = user_environment_ids(request.user)
        if not table.environments.filter(id__in=env_ids).exists():
            return Response({"detail": "Access denied."}, status=403)

        q = (request.query_params.get("q") or "").strip()
        page = max(1, int(request.query_params.get("page", "1")))
        page_size = max(1, min(int(request.query_params.get("page_size", "100")), 1000))
        offset = (page - 1) * page_size
        where_sql = ""
        params = []
        if q:
            where_sql = "WHERE entity_id ILIKE %s OR search_text ILIKE %s"
            like = f"%{q}%"
            params.extend([like, like])

        with connection.cursor() as cursor:
            cursor.execute(f"SELECT COUNT(*) FROM {_q(table.table_name)} {where_sql}", params)
            total = int(cursor.fetchone()[0] or 0)
            cursor.execute(
                f"SELECT * FROM {_q(table.table_name)} {where_sql} ORDER BY id DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            columns = [desc[0] for desc in (cursor.description or [])]
            rows = cursor.fetchall()

        return Response(
            {
                "entity_type": table.entity_type,
                "table_name": table.table_name,
                "q": q,
                "page": page,
                "page_size": page_size,
                "total_rows": total,
                "items": [dict(zip(columns, row)) for row in rows],
            }
        )

