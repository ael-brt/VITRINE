import type {
  Dashboard,
  DashboardData,
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
