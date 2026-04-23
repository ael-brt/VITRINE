from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from django.core.cache import cache

from apps.ngsild.models import DashboardNgsiLdNormalizedEntity


GITHUB_OWNER = "CEREMA"
GITHUB_REPO = "ngsild-api-data-models"
GITHUB_BRANCH = "main"
TREE_URL = (
    f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/trees/"
    f"{GITHUB_BRANCH}?recursive=1"
)
RAW_BASE_URL = (
    f"https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/{GITHUB_BRANCH}/"
)


@dataclass(frozen=True)
class ContextCatalog:
    files: list[str]
    entity_to_context_file: dict[str, str]
    entity_to_uri: dict[str, str]
    context_property_map: dict[str, dict[str, str]]
    global_property_map: dict[str, str]
    skipped_files: list[dict[str, str]]


def _cache_timeout_seconds() -> int:
    try:
        return max(30, int(os.getenv("ONTOLOGY_CACHE_SECONDS", "300")))
    except Exception:
        return 300


def _normalize_token(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "", value).lower()
    return cleaned


def _sanitize_json_like_text(raw: str) -> str:
    return (
        raw.replace("\ufeff", "")
        .replace("\u00a0", " ")
        .replace("\u202f", " ")
        .replace("\u2009", " ")
        .replace("\u2007", " ")
        .replace("\u2060", " ")
        .replace(",}", "}")
        .replace(",]", "]")
    )


def _http_get_json(url: str) -> Any:
    request = Request(
        url=url,
        headers={
            "Accept": "application/json",
            "User-Agent": "vitrine-ontology-service",
        },
        method="GET",
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        try:
            return json.loads(raw)
        except Exception:
            return json.loads(_sanitize_json_like_text(raw))


def _http_get_text(url: str) -> str:
    request = Request(
        url=url,
        headers={
            "Accept": "application/json",
            "User-Agent": "vitrine-ontology-service",
        },
        method="GET",
    )
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8")


def _is_absolute_uri(value: str) -> bool:
    return bool(re.match(r"^(https?://|urn:)", value, flags=re.IGNORECASE))


def _is_likely_prefix(value: str) -> bool:
    return _is_absolute_uri(value) and (value.endswith("/") or value.endswith("#"))


def _resolve_compact_iri(value: str, prefixes: dict[str, str]) -> str:
    if _is_absolute_uri(value):
        return value
    if ":" not in value:
        return ""
    prefix, suffix = value.split(":", 1)
    base = prefixes.get(prefix)
    if not base:
        return ""
    return f"{base}{suffix}"


def _flatten_context(raw_context: Any) -> list[dict[str, Any]]:
    if raw_context is None:
        return []
    if isinstance(raw_context, dict):
        return [raw_context]
    if isinstance(raw_context, list):
        return [item for item in raw_context if isinstance(item, dict)]
    return []


def _is_internal_uri(uri: str) -> bool:
    return "semantics.cerema.fr" in uri.lower()


def _uri_namespace(uri: str) -> str:
    if "#" in uri:
        return uri.rsplit("#", 1)[0] + "#"
    if "/" in uri:
        return uri.rsplit("/", 1)[0] + "/"
    return uri


def _uri_local_name(uri: str) -> str:
    normalized = uri.rstrip("/#")
    if "#" in normalized:
        return normalized.rsplit("#", 1)[1]
    if "/" in normalized:
        return normalized.rsplit("/", 1)[1]
    return normalized


def _is_entity_term(term: str) -> bool:
    if not term:
        return False
    first = term[0]
    return first.isalpha() and first.upper() == first and first.lower() != first


def _classify_definition_source(uri: str) -> str:
    if not uri:
        return "unknown"
    lowered = uri.lower()
    if "semantics.cerema.fr" in lowered:
        return "cerema"
    if "schema.org" in lowered:
        return "schema.org"
    if "wikidata.org" in lowered or "wiki/" in lowered:
        return "wikidata"
    if "uri.etsi.org/ngsi-ld" in lowered:
        return "ngsi-ld"
    if "purl.org" in lowered:
        return "purl"
    try:
        host = lowered.split("://", 1)[1].split("/", 1)[0]
        return host or "external"
    except Exception:
        return "external"


def _build_grouped(items: list[dict[str, str]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, set[str]]] = {}
    for item in items:
        uri = item.get("uri", "")
        if not uri:
            continue
        bucket = grouped.setdefault(uri, {"terms": set(), "source_files": set()})
        bucket["terms"].add(item["term"])
        bucket["source_files"].add(item["source_file"])
    response = []
    for uri, payload in grouped.items():
        response.append(
            {
                "uri": uri,
                "terms": sorted(payload["terms"]),
                "source_files": sorted(payload["source_files"]),
            }
        )
    return sorted(response, key=lambda item: item["uri"])


def _load_context_catalog() -> ContextCatalog:
    cache_key = "ontology:context-catalog:v1"
    cached = cache.get(cache_key)
    if isinstance(cached, ContextCatalog):
        return cached

    files: list[str] = []
    entity_to_context_file: dict[str, str] = {}
    entity_to_uri: dict[str, str] = {}
    context_property_map: dict[str, dict[str, str]] = {}
    global_property_map: dict[str, str] = {}
    skipped_files: list[dict[str, str]] = []

    try:
        tree_payload = _http_get_json(TREE_URL)
        tree_entries = tree_payload.get("tree", []) if isinstance(tree_payload, dict) else []
    except URLError as exc:
        catalog = ContextCatalog(
            files=[],
            entity_to_context_file={},
            entity_to_uri={},
            context_property_map={},
            global_property_map={},
            skipped_files=[{"file": "__tree__", "reason": str(exc)}],
        )
        cache.set(cache_key, catalog, timeout=60)
        return catalog
    except Exception as exc:
        catalog = ContextCatalog(
            files=[],
            entity_to_context_file={},
            entity_to_uri={},
            context_property_map={},
            global_property_map={},
            skipped_files=[{"file": "__tree__", "reason": str(exc)}],
        )
        cache.set(cache_key, catalog, timeout=60)
        return catalog

    for entry in tree_entries:
        if not isinstance(entry, dict):
            continue
        path = str(entry.get("path", ""))
        if str(entry.get("type")) != "blob":
            continue
        if not path.endswith("-context.jsonld"):
            continue
        files.append(path)

    files.sort()

    for path in files:
        try:
            raw = _http_get_text(f"{RAW_BASE_URL}{path}")
            try:
                document = json.loads(raw)
            except Exception:
                document = json.loads(_sanitize_json_like_text(raw))
            contexts = _flatten_context(document.get("@context") if isinstance(document, dict) else None)

            prefixes: dict[str, str] = {}
            for context in contexts:
                for key, raw_value in context.items():
                    if key.startswith("@"):
                        continue
                    if isinstance(raw_value, str) and _is_likely_prefix(raw_value):
                        prefixes[key] = raw_value

            file_property_map: dict[str, str] = {}
            for context in contexts:
                for key, raw_value in context.items():
                    if key.startswith("@"):
                        continue

                    candidate_uri = ""
                    if isinstance(raw_value, str):
                        candidate_uri = _resolve_compact_iri(raw_value, prefixes)
                    elif isinstance(raw_value, dict):
                        identifier = raw_value.get("@id")
                        if isinstance(identifier, str):
                            candidate_uri = _resolve_compact_iri(identifier, prefixes)

                    if not candidate_uri or not _is_absolute_uri(candidate_uri):
                        continue

                    normalized_prop = _normalize_token(key)
                    if normalized_prop:
                        file_property_map.setdefault(normalized_prop, candidate_uri)
                        global_property_map.setdefault(normalized_prop, candidate_uri)

                    entity_terms: list[str] = []
                    is_prefix_decl = isinstance(raw_value, str) and _is_likely_prefix(raw_value)
                    if is_prefix_decl and _is_internal_uri(candidate_uri):
                        entity_terms.append(_uri_local_name(candidate_uri))
                    if _is_entity_term(key):
                        entity_terms.append(key)
                    local_name = _uri_local_name(candidate_uri)
                    if _is_entity_term(local_name):
                        entity_terms.append(local_name)

                    for term in entity_terms:
                        normalized_entity = _normalize_token(term)
                        if not normalized_entity:
                            continue
                        entity_to_context_file.setdefault(normalized_entity, path)
                        entity_to_uri.setdefault(normalized_entity, candidate_uri)

            context_property_map[path] = file_property_map
        except Exception as exc:
            skipped_files.append({"file": path, "reason": str(exc)})

    catalog = ContextCatalog(
        files=files,
        entity_to_context_file=entity_to_context_file,
        entity_to_uri=entity_to_uri,
        context_property_map=context_property_map,
        global_property_map=global_property_map,
        skipped_files=skipped_files,
    )
    cache.set(cache_key, catalog, timeout=_cache_timeout_seconds())
    return catalog


def get_ontology_definitions(
    *,
    dashboard_slug: str | None = None,
    tenant: str | None = None,
    entity_type: str | None = None,
) -> dict[str, Any]:
    cache_key = (
        "ontology:definitions:v2:"
        f"dashboard={dashboard_slug or ''}:tenant={tenant or ''}:entity={entity_type or ''}"
    )
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    catalog = _load_context_catalog()

    query = DashboardNgsiLdNormalizedEntity.objects.all().only(
        "dashboard_slug",
        "tenant",
        "entity_type",
        "entity_payload",
    )
    if dashboard_slug:
        query = query.filter(dashboard_slug=dashboard_slug)
    if tenant:
        query = query.filter(tenant=tenant)
    if entity_type:
        query = query.filter(entity_type=entity_type)

    entity_properties: dict[tuple[str, str], set[str]] = {}
    for row in query.iterator(chunk_size=500):
        key = (row.dashboard_slug, row.entity_type)
        entity_properties.setdefault(key, set())
        payload = row.entity_payload if isinstance(row.entity_payload, dict) else {}
        for prop_name in payload.keys():
            if not isinstance(prop_name, str):
                continue
            if prop_name.startswith("@") or prop_name in {"id", "type"}:
                continue
            entity_properties[key].add(prop_name)

    property_links: list[dict[str, Any]] = []
    for (row_dashboard_slug, row_entity_type), properties in sorted(entity_properties.items()):
        normalized_entity = _normalize_token(row_entity_type)
        source_file = catalog.entity_to_context_file.get(normalized_entity, "unknown-context")
        entity_uri = catalog.entity_to_uri.get(normalized_entity, f"entity:{row_entity_type}")
        file_mapping = catalog.context_property_map.get(source_file, {})

        for prop_name in sorted(properties):
            normalized_prop = _normalize_token(prop_name)
            definition_uri = file_mapping.get(normalized_prop) or catalog.global_property_map.get(
                normalized_prop, ""
            )
            property_links.append(
                {
                    "dashboard_slug": row_dashboard_slug,
                    "entity_type": row_entity_type,
                    "term": prop_name,
                    "uri": definition_uri,
                    "source_file": source_file,
                    "entity_term": row_entity_type,
                    "entity_uri": entity_uri,
                    "is_internal": _is_internal_uri(definition_uri),
                    "definition_source": _classify_definition_source(definition_uri),
                }
            )

    internal = _build_grouped([item for item in property_links if item.get("is_internal")])
    external = _build_grouped(
        [item for item in property_links if not item.get("is_internal") and item.get("uri")]
    )

    response = {
        "files": sorted({item["source_file"] for item in property_links if item["source_file"]}),
        "internal": internal,
        "external": external,
        "property_links": property_links,
        "internal_properties": [item for item in property_links if item.get("is_internal")],
        "skipped_files": catalog.skipped_files,
        "meta": {
            "from_backend_data": True,
            "source_rows": len(property_links),
            "context_files_indexed": len(catalog.files),
        },
    }
    cache.set(cache_key, response, timeout=_cache_timeout_seconds())
    return response

