import { useEffect, useState } from "react";
import { fetchRoadSegments } from "../api/client";
import { SectionTitle } from "../components/SectionTitle/SectionTitle";
import styles from "./Map.module.css";

type Position = [number, number];

type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] };

interface Feature {
  type: "Feature";
  id?: string;
  properties?: {
    id?: string;
    type?: string;
    label?: string;
  };
  geometry: Geometry;
}

interface FeatureCollection {
  type: "FeatureCollection";
  generatedAt?: string;
  sourceUrl?: string;
  featureCount?: number;
  totalEntities?: number;
  features: Feature[];
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 680;
const VIEWBOX_PADDING = 48;

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function isGeometry(value: unknown): value is Geometry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { type?: unknown; coordinates?: unknown };

  if (candidate.type === "Point") {
    return isPosition(candidate.coordinates);
  }

  if (candidate.type === "LineString") {
    return Array.isArray(candidate.coordinates);
  }

  if (candidate.type === "MultiLineString") {
    return Array.isArray(candidate.coordinates);
  }

  return false;
}

function normalizeGeometry(geometry: Geometry): Position[][] {
  if (geometry.type === "Point") {
    return isPosition(geometry.coordinates) ? [[geometry.coordinates]] : [];
  }

  if (geometry.type === "LineString") {
    return Array.isArray(geometry.coordinates)
      ? [geometry.coordinates.filter(isPosition)]
      : [];
  }

  if (geometry.type === "MultiLineString") {
    return Array.isArray(geometry.coordinates)
      ? geometry.coordinates.map((line) => line.filter(isPosition))
      : [];
  }

  return [];
}

function computeBounds(features: Feature[]): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let hasPoint = false;

  for (const feature of features) {
    for (const line of normalizeGeometry(feature.geometry)) {
      for (const [x, y] of line) {
        hasPoint = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return hasPoint ? { minX, minY, maxX, maxY } : null;
}

function projectPoint([x, y]: Position, bounds: Bounds): Position {
  const width = Math.max(bounds.maxX - bounds.minX, 0.000001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.000001);
  const scale = Math.min(
    (VIEWBOX_WIDTH - VIEWBOX_PADDING * 2) / width,
    (VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2) / height,
  );
  const offsetX = (VIEWBOX_WIDTH - width * scale) / 2 - bounds.minX * scale;
  const offsetY = (VIEWBOX_HEIGHT - height * scale) / 2 + bounds.maxY * scale;

  return [x * scale + offsetX, -y * scale + offsetY];
}

function toPath(line: Position[], bounds: Bounds) {
  return line
    .map((point, index) => {
      const [x, y] = projectPoint(point, bounds);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function countByType(features: Feature[]) {
  let lineStrings = 0;
  let points = 0;

  for (const feature of features) {
    if (feature.geometry.type === "Point") {
      points += 1;
    } else {
      lineStrings += 1;
    }
  }

  return { lineStrings, points };
}

function formatGeneratedAt(value?: string) {
  if (!value) {
    return "Aucune synchronisation";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function buildCollection(): FeatureCollection {
  return {
    type: "FeatureCollection",
    generatedAt: undefined,
    sourceUrl: "Django API /api/v1/geodata/segments/",
    featureCount: 0,
    totalEntities: 0,
    features: [],
  };
}

export function Map() {
  const [data, setData] = useState<FeatureCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const segments = await fetchRoadSegments();
        const features: Feature[] = [];
        let generatedAt: string | undefined;
        let sourceUrl = "";

        for (const segment of segments) {
          if (!isGeometry(segment.geometry)) {
            continue;
          }

          features.push({
            type: "Feature",
            id: segment.externalId,
            properties: {
              id: segment.externalId,
              type: segment.segmentType,
              label: segment.label,
            },
            geometry: segment.geometry,
          });

          if (!generatedAt || new Date(segment.syncedAt) > new Date(generatedAt)) {
            generatedAt = segment.syncedAt;
          }

          if (!sourceUrl && segment.sourceUrl) {
            sourceUrl = segment.sourceUrl;
          }
        }

        const payload: FeatureCollection = {
          ...buildCollection(),
          generatedAt,
          sourceUrl: sourceUrl || "Django API",
          featureCount: features.length,
          totalEntities: segments.length,
          features,
        };

        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger les donnees cartographiques depuis l'API.",
          );
          setData(buildCollection());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const features = data?.features ?? [];
  const bounds = computeBounds(features);
  const { lineStrings, points } = countByType(features);

  return (
    <div className={`container ${styles.page}`}>
      <SectionTitle
        eyebrow="Cartographie"
        title="Troncons de route synchronises depuis le backend Django"
        description="La carte consomme l'endpoint geodata de l'API et renderise les geometries en SVG."
      />

      <section className={styles.hero}>
        <div className={`${styles.panel} ${styles.mapPanel}`}>
          <div className={styles.mapFrame}>
            {bounds ? (
              <svg
                className={styles.mapSvg}
                viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
                role="img"
                aria-label="Carte des troncons de route"
              >
                {features.flatMap((feature) =>
                  normalizeGeometry(feature.geometry).map((line, index) => {
                    if (feature.geometry.type === "Point") {
                      const [x, y] = projectPoint(line[0], bounds);

                      return (
                        <circle
                          key={`${feature.id ?? "point"}-${index}`}
                          className={styles.point}
                          cx={x}
                          cy={y}
                          r={4}
                        />
                      );
                    }

                    if (line.length < 2) {
                      return null;
                    }

                    return (
                      <path
                        key={`${feature.id ?? "line"}-${index}`}
                        className={styles.line}
                        d={toPath(line, bounds)}
                      />
                    );
                  }),
                )}
              </svg>
            ) : (
              <div className={styles.emptyState}>
                {loading
                  ? "Chargement de la carte..."
                  : "Aucune geometrie exploitable n'a ete trouvee dans l'API."}
              </div>
            )}
          </div>
        </div>

        <div className={`${styles.panel} ${styles.contentPanel}`}>
          <p className={styles.lead}>
            Cette vue lit directement les troncons depuis le backend Django via
            `/api/v1/geodata/segments/`.
          </p>

          <div className={styles.stats}>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{data?.featureCount ?? 0}</span>
              <div className={styles.statLabel}>geometries affichees</div>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{data?.totalEntities ?? 0}</span>
              <div className={styles.statLabel}>entites source</div>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{lineStrings}</span>
              <div className={styles.statLabel}>lignes ou multilignes</div>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{points}</span>
              <div className={styles.statLabel}>points</div>
            </div>
          </div>

          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.legendLine}`} />
              troncon lineaire
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.legendPoint}`} />
              position ponctuelle
            </span>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.meta}>
            Synchronisation: {formatGeneratedAt(data?.generatedAt)}
            <br />
            Source: {data?.sourceUrl ?? "Django API"}
          </div>
        </div>
      </section>
    </div>
  );
}
