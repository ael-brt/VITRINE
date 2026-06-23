from __future__ import annotations

from hashlib import sha1, sha256
import json
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


def normalize_referenced_media_path(raw_value: object) -> str | None:
    if raw_value is None:
        return None

    candidate: object = raw_value
    if isinstance(candidate, (list, tuple)):
        candidate = candidate[0] if candidate else None
    elif not isinstance(candidate, str):
        candidate = str(candidate)

    if not candidate:
        return None

    value = str(candidate).strip()
    if not value or value.lower() in {"none", "null", "undefined"}:
        return None

    if value.startswith("[") and value.endswith("]"):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list) and parsed:
                value = str(parsed[0]).strip()
            else:
                value = value[1:-1].split(",", 1)[0].strip()
        except Exception:
            value = value[1:-1].split(",", 1)[0].strip()

    value = value.strip("\"'")
    value = value.replace("\\", "/")
    while value.startswith("../"):
        value = value[3:]
    value = value.lstrip("./").lstrip("/")

    normalized = PurePosixPath(value)
    if ".." in normalized.parts or normalized.as_posix() in {"", "."}:
        return None
    return normalized.as_posix()


def resolve_referenced_media_path(root_path: str | Path, raw_value: object) -> tuple[str, Path]:
    relative_path = normalize_referenced_media_path(raw_value)
    if not relative_path:
        raise ValueError("Invalid referenced media path.")

    root = Path(root_path).resolve()
    path = (root / relative_path).resolve()
    if root != path and root not in path.parents:
        raise ValueError("Resolved referenced media path escapes configured root.")
    return relative_path, path


def build_internal_file_url(relative_path: str, prefix: str) -> str:
    normalized = normalize_referenced_media_path(relative_path)
    if not normalized:
        raise ValueError("Invalid relative path.")
    clean_prefix = (prefix or "").strip()
    if not clean_prefix.startswith("/"):
        clean_prefix = f"/{clean_prefix}"
    clean_prefix = clean_prefix.rstrip("/") + "/"
    return f"{clean_prefix}{normalized}"
