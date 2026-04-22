import os

from celery import shared_task

from .sync import enqueue_due_sync_jobs, run_pending_sync_jobs


@shared_task(name="apps.ngsild.enqueue_due_sync_jobs_task")
def enqueue_due_sync_jobs_task() -> dict[str, int]:
    created = enqueue_due_sync_jobs()
    return {"created": created}


@shared_task(name="apps.ngsild.run_pending_sync_jobs_task")
def run_pending_sync_jobs_task() -> dict[str, int]:
    try:
        limit = int(os.getenv("NGSILD_SYNC_RUN_LIMIT", "20"))
    except Exception:
        limit = 20
    return run_pending_sync_jobs(limit=max(1, limit))
