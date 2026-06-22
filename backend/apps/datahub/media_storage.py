from __future__ import annotations

from hashlib import sha1, sha256
from pathlib import Path, PurePosixPath
from uuid import uuid4
import mimetypes

from django.conf import settings
from django.utils.text import slugify


def media_root() -> Path:
    return Path(settings.MEDIA_STORAGE_ROOT).resolve()


def _safe_segment(value: str, fallback: str) -> str:
    normalized = slugify((value or "").strip())
    return normalized or fallback


def build_storage_key(*, dashboard_slug: str, entity_type: str, entity_id: str, original_name: str) -> str:
    dashboard_segment = _safe_segment(dashboard_slug, "global")
    entity_segment = _safe_segment(entity_type, "asset")
    entity_hash = sha1((entity_id or "unbound").encode("utf-8")).hexdigest()[:16]
    extension = Path(original_name or "").suffix.lower()
    extension = extension[:15] if extension else ""
    filename = f"{uuid4().hex}{extension}"
    return str(PurePosixPath(dashboard_segment) / entity_segment / entity_hash / filename)


def normalize_storage_key(storage_key: str) -> str:
    if not storage_key:
        raise ValueError("Empty storage key.")
    normalized = PurePosixPath(storage_key)
    if normalized.is_absolute() or ".." in normalized.parts:
        raise ValueError("Invalid storage key.")
    return normalized.as_posix()


def resolve_storage_path(storage_key: str) -> Path:
    normalized = normalize_storage_key(storage_key)
    root = media_root()
    path = (root / normalized).resolve()
    if root != path and root not in path.parents:
        raise ValueError("Resolved storage path escapes media root.")
    return path


def store_uploaded_file(
    uploaded_file,
    *,
    dashboard_slug: str,
    entity_type: str,
    entity_id: str,
) -> dict[str, str | int]:
    original_name = getattr(uploaded_file, "name", "") or "file"
    storage_key = build_storage_key(
        dashboard_slug=dashboard_slug,
        entity_type=entity_type,
        entity_id=entity_id,
        original_name=original_name,
    )
    target_path = resolve_storage_path(storage_key)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    hasher = sha256()
    size_bytes = 0
    with target_path.open("wb") as destination:
        for chunk in uploaded_file.chunks():
            destination.write(chunk)
            hasher.update(chunk)
            size_bytes += len(chunk)

    mime_type = getattr(uploaded_file, "content_type", "") or mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    return {
        "storage_key": storage_key,
        "original_name": original_name,
        "mime_type": mime_type,
        "size_bytes": size_bytes,
        "checksum_sha256": hasher.hexdigest(),
    }


def delete_storage_file(storage_key: str) -> None:
    path = resolve_storage_path(storage_key)
    if path.exists():
        path.unlink()
    current = path.parent
    root = media_root()
    while current != root and current.exists():
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def build_internal_media_url(storage_key: str) -> str:
    normalized = normalize_storage_key(storage_key)
    prefix = str(getattr(settings, "MEDIA_INTERNAL_URL_PREFIX", "/protected-media/") or "/protected-media/").strip()
    if not prefix.startswith("/"):
        prefix = f"/{prefix}"
    prefix = prefix.rstrip("/") + "/"
    return f"{prefix}{normalized}"
