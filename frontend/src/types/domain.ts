export type Media = {
  type: "image" | "video" | "3d";
  title: string;
  src?: string;
};

export type Project = {
  slug: string;
  title: string;
  summary: string;
  domain: string;
  location: string;
  role: string;
  contribution: string[];
  context: string;
  solution: string[];
  impacts: string[];
  tags: string[];
  media: Media[];
  technologies: string[];
  heroImage?: string;
};

export type Dashboard = {
  slug: string;
  title: string;
  description: string;
  isProtected: boolean;
};

export type RoadSegment = {
  externalId: string;
  label: string;
  segmentType: string;
  geometry: unknown;
  sourceUrl: string;
  syncedAt: string;
};

export type DashboardData = {
  dashboardSlug: string;
  entityType: string | null;
  generatedAt?: string;
  totalEntities: number;
  stats: {
    lineCount: number;
    pointCount: number;
    unknownGeometryCount: number;
  };
  sampleIds: string[];
};
