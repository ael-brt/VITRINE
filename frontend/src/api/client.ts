import type {
  Dashboard,
  DashboardData,
  DashboardKpisData,
  DashboardMapData,
  Media,
  Project,
  RoadSegment,
} from "../types/domain";
import { getAuthToken } from "../auth";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1"
).replace(/\/+$/, "");

type ApiProject = {
  slug: string;
  title: string;
  summary: string;
  domain: string;
  location: string;
  role: string;
  context: string;
  hero_image?: string;
  technologies?: string[];
  tags?: string[];
  contribution?: string[];
  solution?: string[];
  impacts?: string[];
  media?: {
    type: "image" | "video" | "3d";
    title: string;
    src?: string;
  }[];
};

type ApiDashboard = {
  slug: string;
  title: string;
  description: string;
  is_protected: boolean;
};

type ApiRoadSegment = {
  external_id: string;
  label: string;
  segment_type: string;
  geometry: unknown;
  source_url: string;
  synced_at: string;
};

type ApiDashboardData = {
  dashboard_slug: string;
  entity_type: string | null;
  generated_at?: string;
  total_entities?: number;
  stats?: {
    line_count?: number;
    point_count?: number;
    unknown_geometry_count?: number;
  };
  sample_ids?: string[];
};

type ApiDashboardMapItem = {
  id: string;
  type: string;
  tenant: string;
  join_key: string;
  scope: string;
  geometry: unknown;
};

type ApiDashboardMapData = {
  dashboard_slug: string;
  entity_type: string | null;
  tenant: string | null;
  join_key: string | null;
  page: number;
  page_size: number;
  total_rows: number;
  total_items: number;
  items: ApiDashboardMapItem[];
};

type ApiDashboardKpisData = {
  dashboard_slug: string;
  entity_type: string | null;
  tenant: string | null;
  total_entities: number;
  with_join_key: number;
  with_tenant: number;
  with_ngsi_updated_at: number;
  latest_ngsi_updated_at: string | null;
  counts_by_type: Array<{
    entity_type: string;
    count: number;
  }>;
};

function toMedia(items: ApiProject["media"]): Media[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    type: item.type,
    title: item.title,
    src: item.src,
  }));
}

function toProject(item: ApiProject): Project {
  return {
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    domain: item.domain,
    location: item.location,
    role: item.role,
    contribution: item.contribution ?? [],
    context: item.context ?? "",
    solution: item.solution ?? [],
    impacts: item.impacts ?? [],
    tags: item.tags ?? [],
    media: toMedia(item.media),
    technologies: item.technologies ?? [],
    heroImage: item.hero_image,
  };
}

function toDashboard(item: ApiDashboard): Dashboard {
  return {
    slug: item.slug,
    title: item.title,
    description: item.description ?? "",
    isProtected: item.is_protected,
  };
}

function toRoadSegment(item: ApiRoadSegment): RoadSegment {
  return {
    externalId: item.external_id,
    label: item.label ?? "",
    segmentType: item.segment_type ?? "",
    geometry: item.geometry,
    sourceUrl: item.source_url ?? "",
    syncedAt: item.synced_at,
  };
}

function toDashboardData(item: ApiDashboardData): DashboardData {
  return {
    dashboardSlug: item.dashboard_slug,
    entityType: item.entity_type,
    generatedAt: item.generated_at,
    totalEntities: item.total_entities ?? 0,
    stats: {
      lineCount: item.stats?.line_count ?? 0,
      pointCount: item.stats?.point_count ?? 0,
      unknownGeometryCount: item.stats?.unknown_geometry_count ?? 0,
    },
    sampleIds: item.sample_ids ?? [],
  };
}

function toDashboardMapData(item: ApiDashboardMapData): DashboardMapData {
  return {
    dashboardSlug: item.dashboard_slug,
    entityType: item.entity_type,
    tenant: item.tenant,
    joinKey: item.join_key,
    page: item.page,
    pageSize: item.page_size,
    totalRows: item.total_rows,
    totalItems: item.total_items,
    items: (item.items ?? []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      tenant: entry.tenant,
      joinKey: entry.join_key,
      scope: entry.scope,
      geometry: entry.geometry,
    })),
  };
}

function toDashboardKpisData(item: ApiDashboardKpisData): DashboardKpisData {
  return {
    dashboardSlug: item.dashboard_slug,
    entityType: item.entity_type,
    tenant: item.tenant,
    totalEntities: item.total_entities ?? 0,
    withJoinKey: item.with_join_key ?? 0,
    withTenant: item.with_tenant ?? 0,
    withNgsiUpdatedAt: item.with_ngsi_updated_at ?? 0,
    latestNgsiUpdatedAt: item.latest_ngsi_updated_at ?? null,
    countsByType: (item.counts_by_type ?? []).map((entry) => ({
      entityType: entry.entity_type,
      count: entry.count,
    })),
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const token = getAuthToken();
  const headers: HeadersInit = token ? { Authorization: `Token ${token}` } : {};

  const response = await fetch(`${API_BASE_URL}${path}`, { headers });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}) for ${path}`);
  }

  return (await response.json()) as T;
}

export async function fetchProjects(): Promise<Project[]> {
  const payload = await fetchJson<ApiProject[]>("/projects/");
  return payload.map(toProject);
}

export async function fetchProjectBySlug(slug: string): Promise<Project> {
  const payload = await fetchJson<ApiProject>(`/projects/${slug}/`);
  return toProject(payload);
}

export async function fetchDashboards(): Promise<Dashboard[]> {
  const payload = await fetchJson<ApiDashboard[]>("/dashboards/");
  return payload.map(toDashboard);
}

export async function fetchDashboardBySlug(slug: string): Promise<Dashboard> {
  const payload = await fetchJson<ApiDashboard>(`/dashboards/${slug}/`);
  return toDashboard(payload);
}

export async function fetchRoadSegments(): Promise<RoadSegment[]> {
  const payload = await fetchJson<ApiRoadSegment[]>("/geodata/segments/");
  return payload.map(toRoadSegment);
}

export async function fetchDashboardData(slug: string): Promise<DashboardData> {
  const payload = await fetchJson<ApiDashboardData>(`/dashboards/${slug}/data/`);
  return toDashboardData(payload);
}

function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    searchParams.set(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function fetchDashboardMap(
  slug: string,
  params: {
    type?: string | null;
    tenant?: string | null;
    joinKey?: string | null;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<DashboardMapData> {
  const query = buildQuery({
    type: params.type,
    tenant: params.tenant,
    join_key: params.joinKey,
    page: params.page,
    page_size: params.pageSize,
  });
  const payload = await fetchJson<ApiDashboardMapData>(`/dashboards/${slug}/map/${query}`);
  return toDashboardMapData(payload);
}

export async function fetchDashboardKpis(
  slug: string,
  params: {
    type?: string | null;
    tenant?: string | null;
  } = {},
): Promise<DashboardKpisData> {
  const query = buildQuery({
    type: params.type,
    tenant: params.tenant,
  });
  const payload = await fetchJson<ApiDashboardKpisData>(`/dashboards/${slug}/kpis/${query}`);
  return toDashboardKpisData(payload);
}
