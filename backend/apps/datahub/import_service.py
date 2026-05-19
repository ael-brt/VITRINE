from __future__ import annotations

from contextlib import contextmanager

from django.core.cache import cache
from django.utils import timezone

from .client import DatahubClientError, fetch_entities
from .models import EntityTable, ImportLog, ImportRun, Tenant
from .table_ops import DatahubTableError, ensure_entity_table_schema, upsert_entities


def build_fetch_overrides(*, tenant: Tenant, entity_table: EntityTable) -> dict[str, str]:
    overrides: dict[str, str] = {
        "tenant": tenant.api_tenant_value,
        "tenant_header": tenant.tenant_header,
        "auth_url": tenant.auth_url,
        "client_id": tenant.client_id,
        "base_url": tenant.base_url,
        "timeout_seconds": str(tenant.timeout_seconds),
        "page_limit": str(tenant.page_limit),
        "endpoint_path": entity_table.endpoint_path,
    }
    if tenant.context_link:
        overrides["context_link"] = tenant.context_link
    if entity_table.context_link_override:
        overrides["context_link"] = entity_table.context_link_override
    if tenant.client_secret_env_key:
        overrides["client_secret_env_key"] = tenant.client_secret_env_key
    if entity_table.extra_query:
        overrides["extra_query"] = entity_table.extra_query
    return overrides


def _log(run: ImportRun, *, level: str, code: str, message: str) -> None:
    ImportLog.objects.create(import_run=run, level=level, code=code, message=message)


@contextmanager
def _import_lock(entity_table_id: int):
    lock_key = f"datahub:import:lock:entity_table:{entity_table_id}"
    timeout = 60 * 60
    lock = None
    has_lock = False
    if hasattr(cache, "lock"):
        lock = cache.lock(lock_key, timeout=timeout, blocking_timeout=0)
        has_lock = bool(lock.acquire(blocking=False))
    else:
        has_lock = bool(cache.add(lock_key, "1", timeout=timeout))
    try:
        yield has_lock
    finally:
        if has_lock:
            if lock is not None:
                lock.release()
            else:
                cache.delete(lock_key)


def execute_import_run(*, run_id: int, limit: int) -> ImportRun:
    run = ImportRun.objects.select_related("tenant", "entity_table").get(id=run_id)
    entity_table = run.entity_table
    tenant = run.tenant
    limit = max(1, min(int(limit), 50000))
    with _import_lock(entity_table.id) as locked:
        if not locked:
            msg = "Another import is already running for this entity table."
            _log(run, level=ImportLog.Level.WARNING, code="LOCK_BUSY", message=msg)
            run.status = ImportRun.Status.FAILED
            run.error_message = msg
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "error_message", "finished_at"])
            raise RuntimeError(msg)
        _log(run, level=ImportLog.Level.INFO, code="IMPORT_STARTED", message=f"Import started with limit={limit} mode={run.mode}.")
        def _should_stop() -> bool:
            return ImportRun.objects.filter(id=run.id, cancel_requested=True).exists()

        try:
            if _should_stop():
                raise DatahubTableError("Import cancellation requested.")
            ensure_entity_table_schema(entity_table)
            overrides = build_fetch_overrides(tenant=tenant, entity_table=entity_table)
            entities = fetch_entities(
                entity_type=entity_table.entity_type,
                limit=limit,
                overrides=overrides,
                should_stop=_should_stop,
            )
            # Integrity-first guard: a FULL sync cannot safely delete rows if fetch hit the caller cap.
            if run.mode == ImportRun.Mode.FULL and len(entities) >= limit:
                raise RuntimeError(
                    "FULL mode aborted: fetched rows reached import limit. Increase limit to avoid potential data loss."
                )
            written, deleted = upsert_entities(
                entity_table=entity_table,
                tenant=tenant,
                entity_type=entity_table.entity_type,
                entities=entities,
                mode=run.mode,
                should_stop=_should_stop,
            )
            run.status = ImportRun.Status.SUCCESS
            run.rows_read = len(entities)
            run.rows_written = written
            run.rows_deleted = deleted
            run.error_message = ""
            run.finished_at = timezone.now()
            run.save(
                update_fields=[
                    "status",
                    "rows_read",
                    "rows_written",
                    "rows_deleted",
                    "error_message",
                    "finished_at",
                ]
            )
            _log(
                run,
                level=ImportLog.Level.INFO,
                code="IMPORT_SUCCESS",
                message=f"Import completed. rows_read={run.rows_read} rows_written={run.rows_written} rows_deleted={run.rows_deleted}.",
            )
        except (DatahubClientError, DatahubTableError) as exc:
            if "cancellation requested" in str(exc).lower():
                run.status = ImportRun.Status.CANCELLED
                run.error_message = str(exc)
                run.cancelled_at = timezone.now()
                run.finished_at = run.cancelled_at
                run.save(update_fields=["status", "error_message", "cancelled_at", "finished_at"])
                _log(run, level=ImportLog.Level.WARNING, code="IMPORT_CANCELLED", message=str(exc))
                return run
            run.status = ImportRun.Status.FAILED
            run.error_message = str(exc)
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "error_message", "finished_at"])
            _log(run, level=ImportLog.Level.ERROR, code="IMPORT_FAILED", message=str(exc))
            raise
        except Exception as exc:
            run.status = ImportRun.Status.FAILED
            run.error_message = str(exc)
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "error_message", "finished_at"])
            _log(run, level=ImportLog.Level.ERROR, code="IMPORT_FAILED", message=str(exc))
            raise
    return run
