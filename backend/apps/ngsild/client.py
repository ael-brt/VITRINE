import json
import os
import re
from dataclasses import dataclass
from math import ceil
from typing import Any
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


class NgsiLdClientError(RuntimeError):
    pass


@dataclass(frozen=True)
class NgsiLdSettings:
    auth_url: str
    client_id: str
    client_secret: str
    base_url: str
    context_link: str | None
    tenant: str | None
    tenant_header: str
    oauth_scope: str | None
    oauth_audience: str | None
    timeout_seconds: int


def _get_env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    return value.strip() if isinstance(value, str) else value


def _pick(
    overrides: dict[str, str | int | None] | None,
    key: str,
    env_name: str,
    default: str | None = None,
) -> str | None:
    if overrides and key in overrides:
        candidate = overrides.get(key)
        if candidate is not None and str(candidate).strip() != "":
            return str(candidate).strip()
    return _get_env(env_name, default)


def _tenant_to_env_suffix(tenant: str | None) -> str | None:
    if not tenant:
        return None
    normalized = re.sub(r"[^A-Za-z0-9]", "_", tenant).upper()
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized or None


def _resolve_client_secret(tenant: str | None) -> str:
    # Priority:
    # 1) Tenant-specific env var: NGSILD_CLIENT_SECRET__<TENANT>
    # 2) Default env var: NGSILD_CLIENT_SECRET
    suffix = _tenant_to_env_suffix(tenant)
    if suffix:
        scoped = _get_env(f"NGSILD_CLIENT_SECRET__{suffix}")
        if scoped:
            return scoped

    return _get_env("NGSILD_CLIENT_SECRET", "") or ""


def _resolve_tenant_scoped_or_default(
    tenant: str | None,
    base_var_name: str,
    default: str | None = None,
) -> str:
    suffix = _tenant_to_env_suffix(tenant)
    if suffix:
        scoped = _get_env(f"{base_var_name}__{suffix}")
        if scoped:
            return scoped

    return _get_env(base_var_name, default) or ""


def read_settings(overrides: dict[str, str | int | None] | None = None) -> NgsiLdSettings:
    tenant = _pick(overrides, "tenant", "NGSILD_TENANT")

    return NgsiLdSettings(
        auth_url=(
            _pick(overrides, "auth_url", "NGSILD_AUTH_URL", "")
            or _resolve_tenant_scoped_or_default(tenant, "NGSILD_AUTH_URL", "")
        ),
        client_id=(
            _pick(overrides, "client_id", "NGSILD_CLIENT_ID", "")
            or _resolve_tenant_scoped_or_default(tenant, "NGSILD_CLIENT_ID", "")
        ),
        client_secret=_resolve_client_secret(tenant),
        base_url=(_pick(overrides, "base_url", "NGSILD_BASE_URL", "") or "").rstrip("/") + "/",
        context_link=_pick(overrides, "context_link", "NGSILD_CONTEXT_LINK"),
        tenant=tenant,
        tenant_header=_pick(overrides, "tenant_header", "NGSILD_TENANT_HEADER", "NGSILD-Tenant")
        or "NGSILD-Tenant",
        oauth_scope=_pick(overrides, "oauth_scope", "NGSILD_OAUTH_SCOPE"),
        oauth_audience=_pick(overrides, "oauth_audience", "NGSILD_OAUTH_AUDIENCE"),
        timeout_seconds=int(_pick(overrides, "timeout_seconds", "NGSILD_TIMEOUT_SECONDS", "20") or "20"),
    )


def _assert_configured(settings: NgsiLdSettings) -> None:
    missing = []
    if not settings.auth_url:
        missing.append("NGSILD_AUTH_URL")
    if not settings.client_id:
        missing.append("NGSILD_CLIENT_ID")
    if not settings.client_secret:
        missing.append("NGSILD_CLIENT_SECRET")
    if not settings.base_url or settings.base_url == "/":
        missing.append("NGSILD_BASE_URL")

    if missing:
        raise NgsiLdClientError(f"Missing NGSI-LD settings: {', '.join(missing)}")


def _json_request(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    timeout_seconds: int,
) -> tuple[Any, dict[str, str]]:
    request = Request(url=url, method=method, headers=headers, data=body)
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
            payload = json.loads(raw) if raw else None
            response_headers = {k.lower(): v for k, v in response.headers.items()}
            return payload, response_headers
    except Exception as exc:
        raise NgsiLdClientError(str(exc)) from exc


def fetch_access_token(settings: NgsiLdSettings) -> str:
    _assert_configured(settings)

    form = {
        "grant_type": "client_credentials",
        "client_id": settings.client_id,
        "client_secret": settings.client_secret,
    }
    if settings.oauth_scope:
        form["scope"] = settings.oauth_scope
    if settings.oauth_audience:
        form["audience"] = settings.oauth_audience

    payload, _ = _json_request(
        method="POST",
        url=settings.auth_url,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body=urlencode(form).encode("utf-8"),
        timeout_seconds=settings.timeout_seconds,
    )

    if not isinstance(payload, dict) or "access_token" not in payload:
        raise NgsiLdClientError("OAuth token response is invalid.")

    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise NgsiLdClientError("OAuth token response does not contain a valid token.")

    return token


def _parse_next_link(link_header: str | None) -> str | None:
    if not link_header:
        return None

    for part in link_header.split(","):
        segment = part.strip()
        if 'rel="next"' not in segment and "rel=next" not in segment:
            continue
        start = segment.find("<")
        end = segment.find(">", start + 1)
        if start != -1 and end != -1:
            return segment[start + 1 : end]

    return None


def _resolve_page_limit(overrides: dict[str, str | int | None] | None, total_cap: int) -> int:
    raw = None
    if overrides and "page_limit" in overrides:
        raw = overrides.get("page_limit")
    if raw in (None, ""):
        raw = _get_env("NGSILD_PAGE_LIMIT", "300")
    try:
        candidate = int(str(raw))
    except Exception:
        candidate = 300
    # NGSI-LD providers often cap page size around 300.
    return max(1, min(total_cap, candidate))


def fetch_entities(
    entity_type: str,
    limit: int = 1000,
    overrides: dict[str, str | int | None] | None = None,
) -> list[dict[str, Any]]:
    settings = read_settings(overrides=overrides)
    token = fetch_access_token(settings)

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if settings.context_link:
        headers["Link"] = settings.context_link
    if settings.tenant:
        headers[settings.tenant_header] = settings.tenant

    # `limit` is treated as a global cap for returned entities.
    # Per-page fetch size can be configured (default 300) and pagination is handled
    # by Link rel=next when provided, otherwise by offset fallback.
    total_cap = max(1, int(limit))
    page_limit = _resolve_page_limit(overrides, total_cap)
    params = urlencode({"type": entity_type, "limit": str(page_limit), "offset": "0"})
    next_url = urljoin(settings.base_url, f"entities?{params}")
    entities: list[dict[str, Any]] = []
    offset = 0
    # Safety valve against buggy providers repeating the same page indefinitely.
    max_pages = max(1, ceil(total_cap / page_limit) + 2)
    pages_read = 0

    while next_url and len(entities) < total_cap and pages_read < max_pages:
        payload, response_headers = _json_request(
            method="GET",
            url=next_url,
            headers=headers,
            body=None,
            timeout_seconds=settings.timeout_seconds,
        )
        pages_read += 1

        page_items: list[dict[str, Any]] = []
        if isinstance(payload, list):
            remaining = total_cap - len(entities)
            page_items = [item for item in payload if isinstance(item, dict)]
            entities.extend(page_items[:remaining])
        elif payload is None:
            pass
        else:
            raise NgsiLdClientError("NGSI-LD entities response is not a list.")

        if len(entities) >= total_cap:
            break

        candidate = _parse_next_link(response_headers.get("link"))
        if candidate and not candidate.startswith("http"):
            candidate = urljoin(settings.base_url, candidate)
        if candidate:
            next_url = candidate
            continue

        # Fallback pagination by offset when provider does not emit rel=next.
        # Stop once the page is not full.
        if len(page_items) < page_limit:
            break
        offset += page_limit
        next_params = urlencode({"type": entity_type, "limit": str(page_limit), "offset": str(offset)})
        next_url = urljoin(settings.base_url, f"entities?{next_params}")

    return entities


def fetch_types_metadata(
    *,
    overrides: dict[str, str | int | None] | None = None,
    details: bool = True,
) -> list[dict[str, Any]] | dict[str, Any]:
    settings = read_settings(overrides=overrides)
    token = fetch_access_token(settings)

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if settings.context_link:
        headers["Link"] = settings.context_link
    if settings.tenant:
        headers[settings.tenant_header] = settings.tenant

    params = {"details": "true"} if details else {}
    suffix = f"?{urlencode(params)}" if params else ""
    url = urljoin(settings.base_url, f"types{suffix}")

    payload, _response_headers = _json_request(
        method="GET",
        url=url,
        headers=headers,
        body=None,
        timeout_seconds=settings.timeout_seconds,
    )

    if payload is None:
        return []
    if isinstance(payload, (list, dict)):
        return payload
    raise NgsiLdClientError("NGSI-LD types response is not a list/dict.")
