from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils.dateparse import parse_datetime
from django.utils import timezone

from .client import fetch_entities
from .models import DashboardNgsiLdNormalizedEntity, DashboardNgsiLdSource, DashboardNgsiLdSyncJob
from .service import build_source_overrides, resolve_source_entity_types


def enqueue_sync_jobs_for_source(
    source: DashboardNgsiLdSource,
    *,
    triggered_by: str = DashboardNgsiLdSyncJob.TriggeredBy.MANUAL,
) -> int:
    entity_types = resolve_source_entity_types(source, source.dashboard.slug)
    if not entity_types and source.entity_type:
        entity_types = [source.entity_type]
    if not entity_types:
        entity_types = [""]

    created = 0
    for entity_type in entity_types:
        already_exists = DashboardNgsiLdSyncJob.objects.filter(
            source=source,
            entity_type=entity_type,
            status__in=[
                DashboardNgsiLdSyncJob.Status.PENDING,
                DashboardNgsiLdSyncJob.Status.RUNNING,
            ],
        ).exists()
        if already_exists:
            continue

        DashboardNgsiLdSyncJob.objects.create(
            source=source,
            entity_type=entity_type,
            status=DashboardNgsiLdSyncJob.Status.PENDING,
            triggered_by=triggered_by,
        )
        created += 1
    return created


def enqueue_due_sync_jobs(*, now=None) -> int:
    now = now or timezone.now()
    total = 0

    candidates = DashboardNgsiLdSource.objects.select_related("dashboard").filter(
        is_active=True,
        is_sync_enabled=True,
    )
    for source in candidates:
        if source.last_synced_at:
            due_at = source.last_synced_at + timedelta(minutes=source.sync_interval_minutes)
            if due_at > now:
                continue
        total += enqueue_sync_jobs_for_source(
            source,
            triggered_by=DashboardNgsiLdSyncJob.TriggeredBy.SCHEDULE,
        )
    return total


def _upsert_normalized_entities(
    *,
    source: DashboardNgsiLdSource,
    entity_type: str,
    entities: list[dict],
    full_mode: bool,
) -> int:
    def _extract_datetime(value):
        if isinstance(value, dict):
            value = value.get("value")
        if not isinstance(value, str) or not value:
            return None
        parsed = parse_datetime(value)
        if parsed is None:
            return None
        if timezone.is_naive(parsed):
            return timezone.make_aware(parsed, timezone.get_current_timezone())
        return parsed

    def _extract_join_key(entity: dict) -> str:
        for key in ("joinKey", "segmentId", "tronconId", "refInId", "id"):
            value = entity.get(key)
            if isinstance(value, dict):
                value = value.get("value")
            if isinstance(value, str) and value:
                return value[:255]
        return ""

    def _extract_scope(entity: dict) -> str:
        value = entity.get("scope")
        if isinstance(value, dict):
            value = value.get("value")
        if isinstance(value, str):
            return value[:255]
        return ""

    valid_entities = []
    for entity in entities:
        entity_id = entity.get("id")
        if not isinstance(entity_id, str) or not entity_id:
            continue
        valid_entities.append(
            DashboardNgsiLdNormalizedEntity(
                source=source,
                dashboard_slug=source.dashboard.slug,
                tenant=source.tenant or "",
                entity_type=entity_type,
                entity_id=entity_id,
                join_key=_extract_join_key(entity),
                scope=_extract_scope(entity),
                ngsi_updated_at=_extract_datetime(entity.get("modifiedAt") or entity.get("observedAt")),
                entity_payload=entity,
            )
        )

    with transaction.atomic():
        if full_mode:
            DashboardNgsiLdNormalizedEntity.objects.filter(
                source=source,
                entity_type=entity_type,
            ).delete()

        if valid_entities:
            DashboardNgsiLdNormalizedEntity.objects.bulk_create(
                valid_entities,
                batch_size=1000,
                update_conflicts=True,
                update_fields=[
                    "dashboard_slug",
                    "tenant",
                    "join_key",
                    "scope",
                    "ngsi_updated_at",
                    "entity_payload",
                    "updated_at",
                ],
                unique_fields=["source", "entity_type", "entity_id"],
            )

    return len(valid_entities)


def run_sync_job(job: DashboardNgsiLdSyncJob) -> DashboardNgsiLdSyncJob:
    job.status = DashboardNgsiLdSyncJob.Status.RUNNING
    job.started_at = timezone.now()
    job.error_message = ""
    job.save(update_fields=["status", "started_at", "error_message"])

    try:
        full_mode = job.source.sync_mode == DashboardNgsiLdSource.SyncMode.FULL
        entities = fetch_entities(
            entity_type=job.entity_type,
            limit=job.source.request_limit,
            overrides=build_source_overrides(job.source),
        )
        read_count = len(entities)
        upserted_count = _upsert_normalized_entities(
            source=job.source,
            entity_type=job.entity_type,
            entities=entities,
            full_mode=full_mode,
        )

        job.status = DashboardNgsiLdSyncJob.Status.SUCCESS
        job.records_read = read_count
        job.records_upserted = upserted_count
        job.finished_at = timezone.now()
        job.save(
            update_fields=[
                "status",
                "records_read",
                "records_upserted",
                "finished_at",
            ]
        )

        source = job.source
        source.last_synced_at = job.finished_at
        source.save(update_fields=["last_synced_at"])
        return job
    except Exception as exc:
        job.status = DashboardNgsiLdSyncJob.Status.FAILED
        job.finished_at = timezone.now()
        job.error_message = str(exc)
        job.save(update_fields=["status", "finished_at", "error_message"])
        return job


def run_pending_sync_jobs(*, limit: int = 20) -> dict[str, int]:
    jobs = list(
        DashboardNgsiLdSyncJob.objects.select_related("source", "source__dashboard")
        .filter(status=DashboardNgsiLdSyncJob.Status.PENDING)
        .order_by("created_at")[: max(1, limit)]
    )
    success = 0
    failed = 0
    for job in jobs:
        result = run_sync_job(job)
        if result.status == DashboardNgsiLdSyncJob.Status.SUCCESS:
            success += 1
        else:
            failed += 1

    return {"processed": len(jobs), "success": success, "failed": failed}


def sync_source_now(
    source: DashboardNgsiLdSource,
    *,
    mode: str | None = None,
    triggered_by: str = DashboardNgsiLdSyncJob.TriggeredBy.MANUAL,
) -> dict[str, int]:
    original_mode = source.sync_mode
    if mode in {DashboardNgsiLdSource.SyncMode.FULL, DashboardNgsiLdSource.SyncMode.INCREMENTAL}:
        source.sync_mode = mode
        source.save(update_fields=["sync_mode"])

    try:
        created = enqueue_sync_jobs_for_source(source, triggered_by=triggered_by)
        summary = run_pending_sync_jobs(limit=max(1, created))
        summary["created"] = created
        return summary
    finally:
        if source.sync_mode != original_mode:
            source.sync_mode = original_mode
            source.save(update_fields=["sync_mode"])
