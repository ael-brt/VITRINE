from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


class DatahubClientError(RuntimeError):
    pass


class DatahubRetryableError(DatahubClientError):
    pass


class DatahubClientAuthError(DatahubClientError):
    pass


def _require(name: str) -> str:
    value = (os.getenv(name, "") or "").strip()
    if not value:
        raise DatahubClientError(f"Missing environment variable: {name}")
    return value


def _normalize_suffix(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]", "_", value).upper()
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized


def _resolve_client_secret(overrides: dict[str, str]) -> str:
    explicit_env_key = (overrides.get("client_secret_env_key") or "").strip()
    if explicit_env_key:
        scoped = (os.getenv(explicit_env_key, "") or "").strip()
        if scoped:
            return scoped

    tenant_value = (overrides.get("tenant") or "").strip()
    if tenant_value:
        suffix = _normalize_suffix(tenant_value)
        scoped_name = f"NGSILD_CLIENT_SECRET__{suffix}"
        scoped = (os.getenv(scoped_name, "") or "").strip()
        if scoped:
            return scoped

    return _require("NGSILD_CLIENT_SECRET")


def _json_request(*, method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: int) -> tuple[Any, dict[str, str]]:
    max_attempts = max(1, int(os.getenv("NGSILD_HTTP_MAX_ATTEMPTS", "3")))
    base_sleep = float(os.getenv("NGSILD_HTTP_RETRY_BASE_SECONDS", "0.6"))
    req = Request(url=url, method=method, headers=headers, data=body)
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            with urlopen(req, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else None
                return payload, {k.lower(): v for k, v in response.headers.items()}
        except HTTPError as exc:
            if exc.code == 401:
                raise DatahubClientAuthError("HTTP Error 401: Unauthorized") from exc
            # Retry only for transient upstream pressure/failures.
            retryable_http = {408, 409, 425, 429, 500, 502, 503, 504}
            last_exc = exc
            if exc.code not in retryable_http:
                break
            if attempt >= max_attempts:
                break
            time.sleep(base_sleep * (2 ** (attempt - 1)))
        except (TimeoutError, URLError) as exc:
            last_exc = exc
            if attempt >= max_attempts:
                break
            time.sleep(base_sleep * (2 ** (attempt - 1)))
        except Exception as exc:
            raise DatahubClientError(str(exc)) from exc
    if isinstance(last_exc, (HTTPError, URLError, TimeoutError)):
        raise DatahubRetryableError(str(last_exc))
    raise DatahubClientError(str(last_exc) if last_exc else "Unknown HTTP error")


def _oauth_token(*, auth_url: str, client_id: str, client_secret: str, timeout: int) -> str:
    payload, _headers = _json_request(
        method="POST",
        url=auth_url,
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        body=urlencode(
            {"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}
        ).encode("utf-8"),
        timeout=timeout,
    )
    token = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token:
        raise DatahubClientError("Invalid OAuth response.")
    return token


def fetch_entities(
    entity_type: str,
    limit: int = 500,
    overrides: dict[str, str] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> list[dict[str, Any]]:
    overrides = overrides or {}
    timeout = int(overrides.get("timeout_seconds") or os.getenv("NGSILD_TIMEOUT_SECONDS", "20"))
    auth_url = overrides.get("auth_url") or _require("NGSILD_AUTH_URL")
    base_url = (overrides.get("base_url") or _require("NGSILD_BASE_URL")).rstrip("/") + "/"
    client_id = overrides.get("client_id") or _require("NGSILD_CLIENT_ID")
    client_secret = overrides.get("client_secret") or _resolve_client_secret(overrides)
    tenant = overrides.get("tenant") or os.getenv("NGSILD_TENANT", "").strip()
    tenant_header = overrides.get("tenant_header") or os.getenv("NGSILD_TENANT_HEADER", "NGSILD-Tenant")
    context_link = overrides.get("context_link") or os.getenv("NGSILD_CONTEXT_LINK", "").strip()
    page_limit = max(1, min(int(overrides.get("page_limit") or os.getenv("NGSILD_PAGE_LIMIT", "300")), int(limit)))
    endpoint_path = (overrides.get("endpoint_path") or "entities").strip().lstrip("/")
    extra_query = (overrides.get("extra_query") or "").strip()

    token = _oauth_token(auth_url=auth_url, client_id=client_id, client_secret=client_secret, timeout=timeout)
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    if tenant:
        headers[tenant_header] = tenant
    if context_link:
        headers["Link"] = context_link

    entities: list[dict[str, Any]] = []
    offset = 0
    while len(entities) < int(limit):
        if should_stop and should_stop():
            raise DatahubClientError("Import cancellation requested.")
        base_params = {"type": entity_type, "limit": str(page_limit), "offset": str(offset)}
        params = urlencode(base_params)
        if extra_query:
            params = f"{params}&{extra_query}"
        payload, _ = _json_request(
            method="GET",
            url=urljoin(base_url, f"{endpoint_path}?{params}"),
            headers=headers,
            body=None,
            timeout=timeout,
        )
        rows = payload if isinstance(payload, list) else []
        typed = [row for row in rows if isinstance(row, dict)]
        if not typed:
            break
        remaining = int(limit) - len(entities)
        entities.extend(typed[:remaining])
        if len(typed) < page_limit:
            break
        offset += page_limit
    return entities
