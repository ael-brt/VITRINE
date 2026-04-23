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

type LinePath = [number, number][];
type GeometryKind = "point" | "line" | "polygon" | "unknown";

type MapContent = MapPoint & {
  geometryKind: GeometryKind;
  geometryPaths: LinePath[];
};

type BasemapLine = {
  id: string;
  path: LinePath;
};

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 640;
const MAP_PADDING = 42;

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function hasJoinKey(value: string) {
  return value.trim().length > 0;
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

function geometryToPaths(geometry: unknown): { kind: GeometryKind; paths: LinePath[] } {
  if (!geometry || typeof geometry !== "object") {
    return { kind: "unknown", paths: [] };
  }

  const parsed = geometry as { type?: string; coordinates?: unknown };
  const shapeType = parsed.type;
  const coordinates = parsed.coordinates;

  if (!shapeType) {
    return { kind: "unknown", paths: [] };
  }

  if (shapeType === "Point" && isCoordinatePair(coordinates)) {
    return { kind: "point", paths: [[coordinates]] };
  }

  if (shapeType === "MultiPoint" && Array.isArray(coordinates)) {
    const points = coordinates.filter(isCoordinatePair);
    return { kind: points.length > 0 ? "point" : "unknown", paths: points.map((point) => [point]) };
  }

  if (shapeType === "LineString" && Array.isArray(coordinates)) {
    const path = coordinates.filter(isCoordinatePair);
    return { kind: path.length > 1 ? "line" : "unknown", paths: path.length > 1 ? [path] : [] };
  }

  if (shapeType === "MultiLineString" && Array.isArray(coordinates)) {
    const lines = coordinates
      .filter((line): line is unknown[] => Array.isArray(line))
      .map((line) => line.filter(isCoordinatePair))
      .filter((line) => line.length > 1);
    return { kind: lines.length > 0 ? "line" : "unknown", paths: lines };
  }

  if (shapeType === "Polygon" && Array.isArray(coordinates)) {
    const rings = coordinates
      .filter((ring): ring is unknown[] => Array.isArray(ring))
      .map((ring) => ring.filter(isCoordinatePair))
      .filter((ring) => ring.length > 2);
    return { kind: rings.length > 0 ? "polygon" : "unknown", paths: rings };
  }

  if (shapeType === "MultiPolygon" && Array.isArray(coordinates)) {
    const rings: LinePath[] = [];
    for (const polygon of coordinates) {
      if (!Array.isArray(polygon)) continue;
      for (const ring of polygon) {
        if (!Array.isArray(ring)) continue;
        const points = ring.filter(isCoordinatePair);
        if (points.length > 2) {
          rings.push(points);
        }
      }
    }
    return { kind: rings.length > 0 ? "polygon" : "unknown", paths: rings };
  }

  return { kind: "unknown", paths: [] };
}

function mapItemToContent(item: DashboardMapItem): MapContent | null {
  const coordinate = geometryToCoordinate(item.geometry);
  if (!coordinate) {
    return null;
  }
  const geometry = geometryToPaths(item.geometry);

  return {
    id: item.id,
    type: item.type,
    tenant: item.tenant,
    joinKey: item.joinKey,
    scope: item.scope,
    lon: coordinate[0],
    lat: coordinate[1],
    geometryKind: geometry.kind,
    geometryPaths: geometry.paths,
  };
}

function collectCoordinates(contents: MapContent[], basemap: BasemapLine[]) {
  const coordinates: [number, number][] = [];
  for (const content of contents) {
    coordinates.push([content.lon, content.lat]);
    for (const path of content.geometryPaths) {
      for (const point of path) {
        coordinates.push(point);
      }
    }
  }
  for (const line of basemap) {
    for (const point of line.path) {
      coordinates.push(point);
    }
  }
  return coordinates;
}

function createProjector(contents: MapContent[], basemap: BasemapLine[]) {
  const coordinates = collectCoordinates(contents, basemap);
  if (coordinates.length === 0) {
    return null;
  }

  const lons = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const lonSpan = Math.max(maxLon - minLon, 0.00001);
  const latSpan = Math.max(maxLat - minLat, 0.00001);
  const innerWidth = MAP_WIDTH - MAP_PADDING * 2;
  const innerHeight = MAP_HEIGHT - MAP_PADDING * 2;

  return (lon: number, lat: number) => {
    const x = MAP_PADDING + ((lon - minLon) / lonSpan) * innerWidth;
    const y = MAP_PADDING + ((maxLat - lat) / latSpan) * innerHeight;
    return { x, y };
  };
}

function linePathToD(path: LinePath, project: (lon: number, lat: number) => { x: number; y: number }, close = false) {
  if (path.length === 0) return "";
  const first = project(path[0][0], path[0][1]);
  const pieces = [`M ${first.x} ${first.y}`];
  for (let index = 1; index < path.length; index += 1) {
    const point = project(path[index][0], path[index][1]);
    pieces.push(`L ${point.x} ${point.y}`);
  }
  if (close) {
    pieces.push("Z");
  }
  return pieces.join(" ");
}

async function loadBasemapLines(): Promise<BasemapLine[]> {
  try {
    const response = await fetch("/data/troncons.geojson");
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      features?: Array<{ id?: string | number; geometry?: { type?: string; coordinates?: unknown } }>;
    };
    if (!Array.isArray(payload.features)) {
      return [];
    }

    const lines: BasemapLine[] = [];
    payload.features.forEach((feature, index) => {
      const geometry = feature.geometry;
      if (!geometry) return;

      if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
        const path = geometry.coordinates.filter(isCoordinatePair);
        if (path.length > 1) {
          lines.push({ id: `${feature.id ?? index}`, path });
        }
      }

      if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
        geometry.coordinates
          .filter((line): line is unknown[] => Array.isArray(line))
          .forEach((line, lineIndex) => {
            const path = line.filter(isCoordinatePair);
            if (path.length > 1) {
              lines.push({ id: `${feature.id ?? index}-${lineIndex}`, path });
            }
          });
      }
    });

    return lines;
  } catch {
    return [];
  }
}

export function DashboardCeremap3D() {
  const navigate = useNavigate();
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [allContents, setAllContents] = useState<MapContent[]>([]);
  const [basemapLines, setBasemapLines] = useState<BasemapLine[]>([]);
  const [apiTotalRows, setApiTotalRows] = useState(0);
  const [globalLatestNgsiUpdate, setGlobalLatestNgsiUpdate] = useState<string | null>(null);
  const [globalWithNgsiDate, setGlobalWithNgsiDate] = useState(0);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>("all");
  const [selectedTenant, setSelectedTenant] = useState<string>("all");
  const [selectedScope, setSelectedScope] = useState<string>("all");
  const [selectedGeometry, setSelectedGeometry] = useState<string>("all");
  const [selectedJoinKeyFilter, setSelectedJoinKeyFilter] = useState<"all" | "with" | "without">("all");
  const [searchValue, setSearchValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const availableTypes = useMemo(
    () => [...new Set(allContents.map((item) => item.type).filter(Boolean))].sort(),
    [allContents],
  );

  const availableTenants = useMemo(
    () => [...new Set(allContents.map((item) => item.tenant).filter(Boolean))].sort(),
    [allContents],
  );

  const availableScopes = useMemo(
    () => [...new Set(allContents.map((item) => item.scope).filter(Boolean))].sort(),
    [allContents],
  );

  const filteredContents = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();

    return allContents.filter((item) => {
      if (selectedType !== "all" && item.type !== selectedType) return false;
      if (selectedTenant !== "all" && item.tenant !== selectedTenant) return false;
      if (selectedScope !== "all" && item.scope !== selectedScope) return false;
      if (selectedGeometry !== "all" && item.geometryKind !== selectedGeometry) return false;
      if (selectedJoinKeyFilter === "with" && !hasJoinKey(item.joinKey)) return false;
      if (selectedJoinKeyFilter === "without" && hasJoinKey(item.joinKey)) return false;

      if (!normalizedSearch) return true;
      return (
        item.id.toLowerCase().includes(normalizedSearch) ||
        item.joinKey.toLowerCase().includes(normalizedSearch) ||
        item.scope.toLowerCase().includes(normalizedSearch) ||
        item.type.toLowerCase().includes(normalizedSearch) ||
        item.tenant.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [
    allContents,
    searchValue,
    selectedGeometry,
    selectedJoinKeyFilter,
    selectedScope,
    selectedTenant,
    selectedType,
  ]);

  const effectiveSelectedPanelId = useMemo(() => {
    if (filteredContents.length === 0) return null;
    if (selectedPanelId && filteredContents.some((item) => item.id === selectedPanelId)) {
      return selectedPanelId;
    }
    return filteredContents[0].id;
  }, [filteredContents, selectedPanelId]);

  const selectedPanel = useMemo(
    () => filteredContents.find((point) => point.id === effectiveSelectedPanelId) ?? null,
    [effectiveSelectedPanelId, filteredContents],
  );

  const projectedData = useMemo(() => {
    const project = createProjector(filteredContents, basemapLines);
    if (!project) {
      return { points: [], basemap: [], geometryLayers: [] };
    }

    const points = filteredContents.map((point) => ({
      ...point,
      ...project(point.lon, point.lat),
    }));

    const basemap = basemapLines
      .map((line) => ({
        id: line.id,
        d: linePathToD(line.path, project),
      }))
      .filter((line) => line.d);

    const geometryLayers = filteredContents.flatMap((item) =>
      item.geometryPaths
        .map((path, index) => ({
          id: `${item.id}-${index}`,
          itemId: item.id,
          kind: item.geometryKind,
          d: linePathToD(path, project, item.geometryKind === "polygon"),
        }))
        .filter((path) => path.d),
    );

    return { points, basemap, geometryLayers };
  }, [basemapLines, filteredContents]);

  const withJoinKeyCount = useMemo(
    () => filteredContents.filter((item) => hasJoinKey(item.joinKey)).length,
    [filteredContents],
  );

  const uniqueTenantCount = useMemo(
    () => new Set(filteredContents.map((item) => item.tenant).filter(Boolean)).size,
    [filteredContents],
  );

  const uniqueScopeCount = useMemo(
    () => new Set(filteredContents.map((item) => item.scope).filter(Boolean)).size,
    [filteredContents],
  );

  const coveragePercent = useMemo(() => {
    if (allContents.length === 0) return 0;
    return Math.round((filteredContents.length / allContents.length) * 100);
  }, [allContents.length, filteredContents.length]);

  const countsByType = useMemo(() => {
    const counters = new Map<string, number>();
    filteredContents.forEach((item) => {
      counters.set(item.type, (counters.get(item.type) ?? 0) + 1);
    });

    return Array.from(counters.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count);
  }, [filteredContents]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const [dashboard, kpis, map, basemap] = await Promise.all([
          fetchDashboardBySlug("ceremap3d"),
          fetchDashboardKpis("ceremap3d"),
          fetchDashboardMap("ceremap3d", { page: 1, pageSize: 1000 }),
          loadBasemapLines(),
        ]);

        const mapped = map.items
          .map((item) => mapItemToContent(item))
          .filter((point): point is MapContent => point !== null);

        if (!cancelled) {
          setTitle(dashboard.title || DEFAULT_TITLE);
          setDescription(dashboard.description || DEFAULT_DESCRIPTION);
          setAllContents(mapped);
          setBasemapLines(basemap);
          setApiTotalRows(map.totalRows);
          setGlobalLatestNgsiUpdate(kpis.latestNgsiUpdatedAt);
          setGlobalWithNgsiDate(kpis.withNgsiUpdatedAt);
          setSelectedPanelId(mapped[0]?.id ?? null);
          setError(null);
          setIsLoading(false);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger le dashboard ceremap3d depuis l'API.",
          );
          setIsLoading(false);
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
          <span className={styles.statValue}>{filteredContents.length}</span>
          <div className={styles.statLabel}>contenus filtres visibles</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{withJoinKeyCount}</span>
          <div className={styles.statLabel}>contenus avec cle de jointure</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{uniqueTenantCount}</span>
          <div className={styles.statLabel}>tenants actifs</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{uniqueScopeCount}</span>
          <div className={styles.statLabel}>scopes actifs</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{coveragePercent}%</span>
          <div className={styles.statLabel}>couverture du filtre</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{globalWithNgsiDate}</span>
          <div className={styles.statLabel}>contenus avec date NGSI</div>
        </article>
      </div>

      <section className={styles.filters}>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Recherche</span>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="ID, type, tenant, scope, join key"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
        </div>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Join key</span>
          <div className={styles.filterButtons}>
            <button
              className={selectedJoinKeyFilter === "all" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setSelectedJoinKeyFilter("all")}
            >
              Tous
            </button>
            <button
              className={selectedJoinKeyFilter === "with" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setSelectedJoinKeyFilter("with")}
            >
              Avec join key
            </button>
            <button
              className={selectedJoinKeyFilter === "without" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setSelectedJoinKeyFilter("without")}
            >
              Sans join key
            </button>
          </div>
        </div>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Geometrie</span>
          <div className={styles.filterButtons}>
            {["all", "point", "line", "polygon"].map((kind) => (
              <button
                key={kind}
                className={selectedGeometry === kind ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setSelectedGeometry(kind)}
              >
                {kind === "all" ? "Toutes" : kind}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Type</span>
          <div className={styles.filterButtons}>
            <button
              className={selectedType === "all" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setSelectedType("all")}
            >
              Tous
            </button>
            {availableTypes.map((type) => (
              <button
                key={type}
                className={selectedType === type ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setSelectedType(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Tenant</span>
          <div className={styles.filterButtons}>
            <button
              className={selectedTenant === "all" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setSelectedTenant("all")}
            >
              Tous
            </button>
            {availableTenants.map((tenant) => (
              <button
                key={tenant}
                className={selectedTenant === tenant ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setSelectedTenant(tenant)}
              >
                {tenant}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Scope</span>
          <div className={styles.filterButtons}>
            <button
              className={selectedScope === "all" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setSelectedScope("all")}
            >
              Tous
            </button>
            {availableScopes.map((scope) => (
              <button
                key={scope}
                className={selectedScope === scope ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setSelectedScope(scope)}
              >
                {scope}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className={`${styles.surface} ${styles.surfaceInteractive}`}>
        <div className={styles.mapInteractive}>
          {isLoading ? (
            <div className={styles.mapLabel}>Chargement du dashboard Ceremap3D...</div>
          ) : projectedData.points.length === 0 ? (
            <div className={styles.mapLabel}>
              Carte Ceremap3D interactive
              <br />
              Aucun contenu ne correspond aux filtres actifs.
            </div>
          ) : (
            <>
              <svg className={styles.mapSvg} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Carte interactive Ceremap3D">
                <rect x={0} y={0} width={MAP_WIDTH} height={MAP_HEIGHT} className={styles.mapBackdrop} />
                {projectedData.basemap.map((line) => (
                  <path key={line.id} d={line.d} className={styles.mapBasePath} />
                ))}

                {projectedData.geometryLayers.map((layer) => (
                  <path
                    key={layer.id}
                    d={layer.d}
                    className={
                      layer.kind === "polygon"
                        ? layer.itemId === effectiveSelectedPanelId
                          ? styles.mapPolygonActive
                          : styles.mapPolygon
                        : layer.itemId === effectiveSelectedPanelId
                          ? styles.mapLineActive
                          : styles.mapLine
                    }
                    onClick={() => setSelectedPanelId(layer.itemId)}
                  />
                ))}

                {projectedData.points.map((point) => (
                  <circle
                    key={point.id}
                    cx={point.x}
                    cy={point.y}
                    r={point.id === effectiveSelectedPanelId ? 8 : 5}
                    className={point.id === effectiveSelectedPanelId ? styles.mapPointActive : styles.mapPoint}
                    onClick={() => setSelectedPanelId(point.id)}
                  />
                ))}
              </svg>
              <div className={styles.mapLegend}>
                <span>
                  <i className={styles.legendBase} />
                  fond de carte
                </span>
                <span>
                  <i className={styles.legendLine} />
                  geometres lineaires
                </span>
                <span>
                  <i className={styles.legendPolygon} />
                  geometres surfaciques
                </span>
                <span>
                  <i className={styles.legendPoint} />
                  ancrages contenus
                </span>
              </div>
            </>
          )}
        </div>

        <aside className={styles.sidePanel}>
          <h3 className={styles.panelInfoTitle}>Detail du contenu selectionne</h3>
          {selectedPanel ? (
            <dl className={styles.panelInfoList}>
              <div>
                <dt>ID</dt>
                <dd>{selectedPanel.id}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{selectedPanel.type || "N/A"}</dd>
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
                <dt>Geometrie</dt>
                <dd>{selectedPanel.geometryKind}</dd>
              </div>
              <div>
                <dt>Coordonnees</dt>
                <dd>
                  {selectedPanel.lat.toFixed(6)}, {selectedPanel.lon.toFixed(6)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={styles.mutedSmall}>Aucun contenu selectionne.</p>
          )}

          <h3 className={styles.panelInfoTitle}>Distribution par type</h3>
          <div className={styles.distribution}>
            {countsByType.length === 0 ? (
              <p className={styles.mutedSmall}>Aucune donnee.</p>
            ) : (
              countsByType.map((entry) => (
                <button
                  key={entry.type}
                  className={styles.typeBarRow}
                  onClick={() => setSelectedType(entry.type)}
                  title="Cliquer pour filtrer la carte et les KPI"
                >
                  <span className={styles.typeBarLabel}>{entry.type}</span>
                  <span className={styles.typeBarTrack}>
                    <span
                      className={styles.typeBarFill}
                      style={{
                        width: `${Math.max(8, Math.round((entry.count / Math.max(...countsByType.map((item) => item.count))) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className={styles.typeBarCount}>{entry.count}</span>
                </button>
              ))
            )}
          </div>

          <h3 className={styles.panelInfoTitle}>Vue des contenus ({filteredContents.length})</h3>
          <div className={styles.contentList}>
            {filteredContents.slice(0, 80).map((item) => (
              <button
                key={item.id}
                className={item.id === effectiveSelectedPanelId ? styles.contentRowActive : styles.contentRow}
                onClick={() => setSelectedPanelId(item.id)}
              >
                <strong>{item.id}</strong>
                <span>{item.type || "N/A"}</span>
                <span>{item.scope || "N/A"}</span>
              </button>
            ))}
            {filteredContents.length > 80 ? (
              <p className={styles.mutedSmall}>+ {filteredContents.length - 80} contenus supplementaires</p>
            ) : null}
          </div>
        </aside>
      </div>

      <p className={styles.footerHint}>
        Source API: {filteredContents.length}/{allContents.length} contenus charges localement
        {apiTotalRows > allContents.length ? ` (API annonce ${apiTotalRows} lignes au total)` : ""}
        {globalLatestNgsiUpdate ? ` - derniere date NGSI: ${new Date(globalLatestNgsiUpdate).toLocaleString("fr-FR")}` : ""}
      </p>
    </div>
  );
}
