from __future__ import annotations

from celery import shared_task

from .client import DatahubRetryableError
from .import_service import execute_import_run
from .models import ImportRun


@shared_task(
    bind=True,
    name="datahub.import_entity_table",
    autoretry_for=(DatahubRetryableError,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 5},
    soft_time_limit=6900,
    time_limit=7200,
)
def import_entity_table_task(self, *, run_id: int, limit: int) -> dict[str, int | str]:
    if not ImportRun.objects.filter(id=run_id).exists():
        return {"run_id": run_id, "status": "missing_run", "rows_read": 0, "rows_written": 0, "rows_deleted": 0}
    run = execute_import_run(run_id=run_id, limit=limit)
    return {
        "run_id": run.id,
        "status": run.status,
        "rows_read": run.rows_read,
        "rows_written": run.rows_written,
        "rows_deleted": run.rows_deleted,
    }
