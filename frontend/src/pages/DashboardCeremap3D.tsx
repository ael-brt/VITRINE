import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDashboardBySlug, fetchDashboardKpis, fetchDashboardMap } from "../api/client";
import type { DashboardMapItem } from "../types/domain";
import styles from "./Dashboard.module.css";

const DEFAULT_TITLE = "Dashboard ceremap3d";
const DEFAULT_DESCRIPTION =
  "Vue metier pour le suivi des panneaux de signalisation et des indicateurs Ceremap3D.";

type MapPoint = {
  id: string;
  type: string;
  tenant: string;
  joinKey: string;
  scope: string;
  lon: number;
  lat: number;
};

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function geometryToCoordinate(geometry: unknown): [number, number] | null {
  if (!geometry || typeof geometry !== "object") {
    return null;
  }

  const parsed = geometry as { type?: string; coordinates?: unknown };
  const shapeType = parsed.type;
  const coordinates = parsed.coordinates;

  if (!shapeType) {
    return null;
  }

  if (shapeType === "Point" && isCoordinatePair(coordinates)) {
    return [coordinates[0], coordinates[1]];
  }

  if (shapeType === "MultiPoint" && Array.isArray(coordinates)) {
    const first = coordinates.find(isCoordinatePair);
    if (first) return [first[0], first[1]];
  }

  if (shapeType === "LineString" && Array.isArray(coordinates)) {
    const line = coordinates.filter(isCoordinatePair);
    if (line.length > 0) {
      const mid = line[Math.floor(line.length / 2)];
      return [mid[0], mid[1]];
    }
  }

  if (shapeType === "MultiLineString" && Array.isArray(coordinates)) {
    const firstLine = coordinates.find((line) => Array.isArray(line)) as unknown[] | undefined;
    if (firstLine) {
      const line = firstLine.filter(isCoordinatePair);
      if (line.length > 0) {
        const mid = line[Math.floor(line.length / 2)];
        return [mid[0], mid[1]];
      }
    }
  }

  if (shapeType === "Polygon" && Array.isArray(coordinates)) {
    const outer = coordinates[0];
    if (Array.isArray(outer)) {
      const ring = outer.filter(isCoordinatePair);
      if (ring.length > 0) {
        const lon = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
        const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
        return [lon, lat];
      }
    }
  }

  if (shapeType === "MultiPolygon" && Array.isArray(coordinates)) {
    const firstPolygon = coordinates[0];
    if (Array.isArray(firstPolygon) && Array.isArray(firstPolygon[0])) {
      const ring = (firstPolygon[0] as unknown[]).filter(isCoordinatePair);
      if (ring.length > 0) {
        const lon = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
        const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
        return [lon, lat];
      }
    }
  }

  return null;
}

function mapItemToPoint(item: DashboardMapItem): MapPoint | null {
  const coordinate = geometryToCoordinate(item.geometry);
  if (!coordinate) {
    return null;
  }
  return {
    id: item.id,
    type: item.type,
    tenant: item.tenant,
    joinKey: item.joinKey,
    scope: item.scope,
    lon: coordinate[0],
    lat: coordinate[1],
  };
}

export function DashboardCeremap3D() {
  const navigate = useNavigate();
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [totalPanneaux, setTotalPanneaux] = useState(0);
  const [mappedPanneaux, setMappedPanneaux] = useState(0);
  const [withJoinKey, setWithJoinKey] = useState(0);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPanel = useMemo(
    () => points.find((point) => point.id === selectedPanelId) ?? null,
    [points, selectedPanelId],
  );

  const projectedPoints = useMemo(() => {
    if (points.length === 0) {
      return [];
    }

    const lons = points.map((point) => point.lon);
    const lats = points.map((point) => point.lat);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const lonSpan = Math.max(maxLon - minLon, 0.000001);
    const latSpan = Math.max(maxLat - minLat, 0.000001);

    const width = 1000;
    const height = 520;
    const padding = 30;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;

    return points.map((point) => ({
      ...point,
      x: padding + ((point.lon - minLon) / lonSpan) * innerWidth,
      y: padding + ((maxLat - point.lat) / latSpan) * innerHeight,
    }));
  }, [points]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [dashboard, kpis, map] = await Promise.all([
          fetchDashboardBySlug("ceremap3d"),
          fetchDashboardKpis("ceremap3d", { type: "Panneau" }),
          fetchDashboardMap("ceremap3d", { type: "Panneau", page: 1, pageSize: 500 }),
        ]);

        const mapped = map.items
          .map((item) => mapItemToPoint(item))
          .filter((point): point is MapPoint => point !== null);

        if (!cancelled) {
          setTitle(dashboard.title || DEFAULT_TITLE);
          setDescription(dashboard.description || DEFAULT_DESCRIPTION);
          setTotalPanneaux(kpis.totalEntities);
          setMappedPanneaux(mapped.length);
          setWithJoinKey(kpis.withJoinKey);
          setPoints(mapped);
          setSelectedPanelId(mapped[0]?.id ?? null);
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger le dashboard ceremap3d depuis l'API.",
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.top}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
          {error ? <p className="muted">{error}</p> : null}
        </div>
        <button className={styles.back} onClick={() => navigate("/dashboardhome")}>
          Retour au dashboard home
        </button>
      </div>

      <div className={styles.stats}>
        <article className={styles.stat}>
          <span className={styles.statValue}>{totalPanneaux}</span>
          <div className={styles.statLabel}>panneaux total</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{mappedPanneaux}</span>
          <div className={styles.statLabel}>panneaux avec geometrie</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{withJoinKey}</span>
          <div className={styles.statLabel}>panneaux avec cle de jointure</div>
        </article>
      </div>

      <div className={styles.surface}>
        <div className={styles.map}>
          {projectedPoints.length === 0 ? (
            <div className={styles.mapLabel}>
              Carte Ceremap3D - Panneau
              <br />
              Aucune geometrie exploitable pour le moment.
            </div>
          ) : (
            <>
              <svg className={styles.mapSvg} viewBox="0 0 1000 520" role="img" aria-label="Carte panneaux Ceremap3D">
                {projectedPoints.map((point) => (
                  <circle
                    key={point.id}
                    cx={point.x}
                    cy={point.y}
                    r={point.id === selectedPanelId ? 8 : 5}
                    className={point.id === selectedPanelId ? styles.mapPointActive : styles.mapPoint}
                    onClick={() => setSelectedPanelId(point.id)}
                  />
                ))}
              </svg>
              {selectedPanel ? (
                <aside className={styles.panelInfo}>
                  <h3 className={styles.panelInfoTitle}>Panneau selectionne</h3>
                  <dl className={styles.panelInfoList}>
                    <div>
                      <dt>ID</dt>
                      <dd>{selectedPanel.id}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>{selectedPanel.type}</dd>
                    </div>
                    <div>
                      <dt>Tenant</dt>
                      <dd>{selectedPanel.tenant || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Join key</dt>
                      <dd>{selectedPanel.joinKey || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Scope</dt>
                      <dd>{selectedPanel.scope || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Coordonnees</dt>
                      <dd>
                        {selectedPanel.lat.toFixed(6)}, {selectedPanel.lon.toFixed(6)}
                      </dd>
                    </div>
                  </dl>
                </aside>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
