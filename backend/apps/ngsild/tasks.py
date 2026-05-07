import os

from celery import shared_task

from .join_views import JoinViewError, refresh_join_relation
from .models import DashboardNgsiLdJoinRule, DashboardNgsiLdSqlRelation, DashboardNgsiLdSyncJob
from .sql_relations import SqlRelationError, deploy_sql_relation, refresh_sql_relation
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


@shared_task(name="apps.ngsild.refresh_join_relation_task")
def refresh_join_relation_task(rule_id: int) -> dict[str, str | int]:
    try:
        rule = DashboardNgsiLdJoinRule.objects.select_related("dashboard").get(id=rule_id)
    except DashboardNgsiLdJoinRule.DoesNotExist:
        return {"rule_id": rule_id, "status": "missing"}

    try:
        refresh_join_relation(rule)
        return {"rule_id": rule_id, "status": "success"}
    except JoinViewError as exc:
        rule.last_refresh_status = "failed"
        rule.last_refresh_error = str(exc)
        rule.save(update_fields=["last_refresh_status", "last_refresh_error"])
        return {"rule_id": rule_id, "status": "failed"}


@shared_task(name="apps.ngsild.deploy_sql_relation_task")
def deploy_sql_relation_task(relation_id: int) -> dict[str, str | int]:
    try:
        relation = DashboardNgsiLdSqlRelation.objects.select_related("dashboard").get(id=relation_id)
    except DashboardNgsiLdSqlRelation.DoesNotExist:
        return {"relation_id": relation_id, "status": "missing"}
    try:
        deploy_sql_relation(relation)
        return {"relation_id": relation_id, "status": "success"}
    except SqlRelationError as exc:
        relation.last_refresh_status = "failed"
        relation.last_refresh_error = str(exc)
        relation.save(update_fields=["last_refresh_status", "last_refresh_error"])
        return {"relation_id": relation_id, "status": "failed"}


@shared_task(name="apps.ngsild.refresh_sql_relation_task")
def refresh_sql_relation_task(relation_id: int) -> dict[str, str | int]:
    try:
        relation = DashboardNgsiLdSqlRelation.objects.select_related("dashboard").get(id=relation_id)
    except DashboardNgsiLdSqlRelation.DoesNotExist:
        return {"relation_id": relation_id, "status": "missing"}
    try:
        refresh_sql_relation(relation)
        return {"relation_id": relation_id, "status": "success"}
    except SqlRelationError as exc:
        relation.last_refresh_status = "failed"
        relation.last_refresh_error = str(exc)
        relation.save(update_fields=["last_refresh_status", "last_refresh_error"])
        return {"relation_id": relation_id, "status": "failed"}
