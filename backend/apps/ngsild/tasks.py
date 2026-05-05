import os

from celery import shared_task

from .models import DashboardNgsiLdSyncJob
from .sync import enqueue_due_sync_jobs, run_pending_sync_jobs, run_sync_job


@shared_task(name="apps.ngsild.enqueue_due_sync_jobs_task")
def enqueue_due_sync_jobs_task() -> dict[str, int]:
    created = enqueue_due_sync_jobs()
    return {"created": created}


@shared_task(name="apps.ngsild.run_pending_sync_jobs_task")
def run_pending_sync_jobs_task() -> dict[str, int]:
    auto_run_enabled = os.getenv("NGSILD_SYNC_AUTO_RUN_PENDING", "false").lower() == "true"
    if not auto_run_enabled:
        return {"processed": 0, "success": 0, "failed": 0}

    try:
        limit = int(os.getenv("NGSILD_SYNC_RUN_LIMIT", "20"))
    except Exception:
        limit = 20
    return run_pending_sync_jobs(limit=max(1, limit))


@shared_task(
    bind=True,
    name="apps.ngsild.run_sync_job_task",
    autoretry_for=(TimeoutError,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def run_sync_job_task(self, job_id: int) -> dict[str, str | int]:
    try:
        job = DashboardNgsiLdSyncJob.objects.select_related("source", "source__dashboard").get(id=job_id)
    except DashboardNgsiLdSyncJob.DoesNotExist:
        return {"job_id": job_id, "status": "missing"}

    if job.status != DashboardNgsiLdSyncJob.Status.PENDING:
        return {"job_id": job_id, "status": f"skipped:{job.status}"}

    result = run_sync_job(job)
    if result.status == DashboardNgsiLdSyncJob.Status.FAILED:
        message = (result.error_message or "").lower()
        is_transient = any(
            token in message
            for token in (
                "timed out",
                "timeout",
                "connection",
                "temporarily unavailable",
                "service unavailable",
                "502",
                "503",
                "504",
            )
        )
        if is_transient and self.request.retries < 3:
            # Requeue only transient provider/network failures.
            result.status = DashboardNgsiLdSyncJob.Status.PENDING
            result.save(update_fields=["status"])
            raise self.retry(countdown=min(120, 10 * (2 ** self.request.retries)))
    return {"job_id": job_id, "status": result.status}
