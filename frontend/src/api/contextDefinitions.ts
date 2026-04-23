import { getAuthToken } from "../auth";

const CACHE_KEY = "vitrine.context-definitions.backend.v2";
const API_URL = "/api/v1/ontology/definitions/";

export type ContextDefinitionsFilters = {
  dashboard?: string | null;
  entityType?: string | null;
  tenant?: string | null;
};

export type GroupedDefinition = {
  uri: string;
  terms: string[];
  sourceFiles: string[];
};

export type InternalPropertyLink = {
  dashboardSlug: string;
  entityType: string;
  term: string;
  uri: string;
  sourceFile: string;
  entityTerm: string;
  entityUri: string;
  isInternal: boolean;
  definitionSource: string;
};

export type ContextDefinitionsResult = {
  files: string[];
  internal: GroupedDefinition[];
  external: GroupedDefinition[];
  propertyLinks: InternalPropertyLink[];
  internalProperties: InternalPropertyLink[];
  skippedFiles: Array<{ file: string; reason: string }>;
};

type ApiGroupedDefinition = {
  uri: string;
  terms: string[];
  source_files: string[];
};

type ApiPropertyLink = {
  dashboard_slug: string;
  entity_type: string;
  term: string;
  uri: string;
  source_file: string;
  entity_term: string;
  entity_uri: string;
  is_internal: boolean;
  definition_source: string;
};

type ApiOntologyPayload = {
  files: string[];
  internal: ApiGroupedDefinition[];
  external: ApiGroupedDefinition[];
  property_links: ApiPropertyLink[];
  internal_properties: ApiPropertyLink[];
  skipped_files: Array<{ file: string; reason: string }>;
};

function buildCacheKey(filters?: ContextDefinitionsFilters): string {
  const dashboard = filters?.dashboard?.trim() || "";
  const entityType = filters?.entityType?.trim() || "";
  const tenant = filters?.tenant?.trim() || "";
  return `${CACHE_KEY}:dashboard=${dashboard}:entity=${entityType}:tenant=${tenant}`;
}

function readSessionCache(cacheKey: string): ContextDefinitionsResult | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(cacheKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ContextDefinitionsResult;
  } catch {
    return null;
  }
}

function writeSessionCache(cacheKey: string, payload: ContextDefinitionsResult) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(cacheKey, JSON.stringify(payload));
}

function mapGrouped(items: ApiGroupedDefinition[] | undefined): GroupedDefinition[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    uri: item.uri ?? "",
    terms: Array.isArray(item.terms) ? item.terms : [],
    sourceFiles: Array.isArray(item.source_files) ? item.source_files : [],
  }));
}

function mapLinks(items: ApiPropertyLink[] | undefined): InternalPropertyLink[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    dashboardSlug: item.dashboard_slug ?? "",
    entityType: item.entity_type ?? "",
    term: item.term ?? "",
    uri: item.uri ?? "",
    sourceFile: item.source_file ?? "",
    entityTerm: item.entity_term ?? "",
    entityUri: item.entity_uri ?? "",
    isInternal: !!item.is_internal,
    definitionSource: item.definition_source ?? "unknown",
  }));
}

function buildUrl(filters?: ContextDefinitionsFilters): string {
  const search = new URLSearchParams();
  const dashboard = filters?.dashboard?.trim();
  const entityType = filters?.entityType?.trim();
  const tenant = filters?.tenant?.trim();
  if (dashboard) {
    search.set("dashboard", dashboard);
  }
  if (entityType) {
    search.set("entity_type", entityType);
  }
  if (tenant) {
    search.set("tenant", tenant);
  }
  const query = search.toString();
  return query ? `${API_URL}?${query}` : API_URL;
}

export async function fetchContextDefinitions(
  filters?: ContextDefinitionsFilters,
): Promise<ContextDefinitionsResult> {
  const cacheKey = buildCacheKey(filters);
  const cached = readSessionCache(cacheKey);
  if (cached) {
    return cached;
  }

  const token = getAuthToken();
  const headers: HeadersInit = token ? { Authorization: `Token ${token}` } : {};

  const response = await fetch(buildUrl(filters), { headers });
  if (!response.ok) {
    throw new Error(`Impossible de charger les definitions ontology (${response.status}).`);
  }

  const payload = (await response.json()) as ApiOntologyPayload;
  const propertyLinks = mapLinks(payload.property_links);
  const result: ContextDefinitionsResult = {
    files: Array.isArray(payload.files) ? payload.files : [],
    internal: mapGrouped(payload.internal),
    external: mapGrouped(payload.external),
    propertyLinks,
    internalProperties: mapLinks(payload.internal_properties),
    skippedFiles: Array.isArray(payload.skipped_files) ? payload.skipped_files : [],
  };
  writeSessionCache(cacheKey, result);
  return result;
}
