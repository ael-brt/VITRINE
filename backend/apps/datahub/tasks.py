from __future__ import annotations

from celery import shared_task

from .import_service import execute_import_run


@shared_task(
    bind=True,
    name="datahub.import_entity_table",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def import_entity_table_task(self, *, run_id: int, limit: int) -> dict[str, int | str]:
    run = execute_import_run(run_id=run_id, limit=limit)
    return {
        "run_id": run.id,
        "status": run.status,
        "rows_read": run.rows_read,
        "rows_written": run.rows_written,
        "rows_deleted": run.rows_deleted,
    }
