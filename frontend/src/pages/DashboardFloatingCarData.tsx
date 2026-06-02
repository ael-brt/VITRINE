import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchDashboardBySlug } from "../api/client";
import { getAuthToken } from "../auth";
import styles from "./Dashboard.module.css";

const DEFAULT_TITLE = "Dashboard floatingcardata";
const DEFAULT_DESCRIPTION = "Vue metier pour les troncons routiers et donnees HERE.";
const GEOJSON_URL =
  (import.meta.env.VITE_FLOATINGCAR_GEOJSON_URL as string | undefined)?.trim() ||
  "/api/v1/datahub/sqlviews/troncon_here_join/geojson/";

type FeatureProperties = Record<string, unknown>;

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<
    GeoJSON.Feature<GeoJSON.Geometry, FeatureProperties> & {
      id?: string | number;
      properties?: FeatureProperties;
    }
  >;
};

type DatePreset = "1h" | "2h" | "3h";

type MetricOption = {
  key: string;
  label: string;
  count: number;
};

type TextProperty = {
  key: string;
  value: string;
};

type DashboardFeature = GeoJsonFeatureCollection["features"][number];

function isFeatureProperties(value: unknown): value is FeatureProperties {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseFeatureStartDate(properties: FeatureProperties): Date | null {
  const primary = ["windowStart"];
  const fallback = ["timestamp", "date", "observedAt", "anchorHour", "windowEnd", "here_windowStart"];
  const keys = [...primary, ...fallback];
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return null;
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isNumericValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumberValue(value: unknown): number | null {
  if (isNumericValue(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isLikelyMetricKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "id" || normalized === "type" || normalized === "label") {
    return false;
  }
  if (normalized.endsWith("_id")) {
    return false;
  }
  return true;
}

function isLikelyTextKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !normalized.startsWith("_");
}

function getFeatureProperties(feature: DashboardFeature): FeatureProperties {
  return isFeatureProperties(feature.properties) ? feature.properties : {};
}

function getFeatureKey(feature: DashboardFeature): string {
  const props = getFeatureProperties(feature);
  const candidates = [
    props.aPourTronconDeRoute,
    props.join_key,
    props.joinKey,
    props.routeId,
    props.segmentId,
    props.entity_id,
    props.entityId,
    props.id,
    feature.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return "unknown";
}

function getTextProperties(feature: DashboardFeature): TextProperty[] {
  const props = getFeatureProperties(feature);
  const preferredOrder = [
    "label",
    "nom",
    "libelle",
    "name",
    "type",
    "scope",
    "windowStart",
    "windowEnd",
    "timestamp",
    "observedAt",
  ];

  const entries = Object.entries(props)
    .filter(([key, value]) => isLikelyTextKey(key) && getStringValue(value))
    .map(([key, value]) => ({ key, value: getStringValue(value) as string }));

  return entries.sort((left, right) => {
    const leftRank = preferredOrder.indexOf(left.key);
    const rightRank = preferredOrder.indexOf(right.key);
    if (leftRank !== rightRank) {
      return (leftRank === -1 ? 999 : leftRank) - (rightRank === -1 ? 999 : rightRank);
    }
    return left.key.localeCompare(right.key);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTooltipHtml(feature: DashboardFeature): string {
  const props = getFeatureProperties(feature);
  const lines = getTextProperties(feature);
  const header = getStringValue(props.label) || getStringValue(props.name) || getStringValue(props.libelle) || getFeatureKey(feature);
  const body =
    lines.length > 0
      ? lines
          .map(
            (entry) =>
              `<div class="floatingcar-tooltip__row"><span class="floatingcar-tooltip__key">${escapeHtml(
                formatLabel(entry.key),
              )}</span><span class="floatingcar-tooltip__value">${escapeHtml(entry.value)}</span></div>`,
          )
          .join("")
      : '<div class="floatingcar-tooltip__empty">Aucune valeur textuelle</div>';

  return `
    <div class="floatingcar-tooltip">
      <div class="floatingcar-tooltip__title">${escapeHtml(header)}</div>
      ${body}
    </div>
  `;
}

function discoverMetricOptions(features: DashboardFeature[]): MetricOption[] {
  const counts = new Map<string, number>();

  for (const feature of features) {
    const props = getFeatureProperties(feature);
    for (const [key, value] of Object.entries(props)) {
      if (!isLikelyMetricKey(key)) {
        continue;
      }

      const numeric = toNumberValue(value);
      if (numeric === null) {
        continue;
      }

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      label: formatLabel(key),
      count,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
}

function formatNumber(value: number, metricKey: string): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  const lowerKey = metricKey.toLowerCase();
  if (lowerKey.includes("pct") || lowerKey.includes("ratio")) {
    return value.toFixed(2);
  }

  return value.toFixed(3);
}

function buildColorScale(values: number[]) {
  if (values.length === 0) {
    return () => "rgba(24, 119, 242, 0.72)";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  return (value: number | null) => {
    if (value === null || !Number.isFinite(value)) {
      return "rgba(24, 119, 242, 0.35)";
    }

    const ratio = max > min ? (value - min) / (max - min) : 0.5;
    const clamped = Math.max(0, Math.min(1, ratio));
    const r = Math.round(35 + clamped * 205);
    const g = Math.round(110 + clamped * 30);
    const b = Math.round(214 - clamped * 140);
    return `rgb(${r}, ${g}, ${b})`;
  };
}

function buildWeightScale(counts: number[]) {
  if (counts.length === 0) {
    return () => 3;
  }

  const min = Math.min(...counts);
  const max = Math.max(...counts);

  return (count: number) => {
    const ratio = max > min ? (count - min) / (max - min) : 0.5;
    return 2.4 + Math.max(0, Math.min(1, ratio)) * 6.2;
  };
}

function fromIsoLocalInput(value: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toUtcDayKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${value.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DashboardFloatingCarData() {
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const geoLayerRef = useRef<L.GeoJSON | null>(null);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [originalData, setOriginalData] = useState<GeoJsonFeatureCollection | null>(null);
  const [preset, setPreset] = useState<DatePreset>("3h");
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedHourStart, setSelectedHourStart] = useState<string>("");
  const [metric, setMetric] = useState<string>("congestionRatio");

  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map("floating-map", { zoomControl: true }).setView([46.6, 2.2], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(mapRef.current);
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = getAuthToken();
        const headers: HeadersInit = token ? { Authorization: `Token ${token}` } : {};
        const [dashboard, geojsonResponse] = await Promise.all([
          fetchDashboardBySlug("floatingcardata"),
          fetch(GEOJSON_URL, { headers }),
        ]);
        if (!geojsonResponse.ok) {
          throw new Error(`GeoJSON non disponible (${geojsonResponse.status}).`);
        }
        const payload = (await geojsonResponse.json()) as GeoJsonFeatureCollection;
        if (!cancelled) {
          setTitle(dashboard.title || DEFAULT_TITLE);
          setDescription(dashboard.description || DEFAULT_DESCRIPTION);
          setOriginalData(payload);
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger les donnees cartographiques.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedWindowHours = preset === "1h" ? 1 : preset === "2h" ? 2 : 3;

  const allFeatures = originalData?.features ?? [];

  const metricOptions = useMemo(() => discoverMetricOptions(allFeatures), [allFeatures]);

  useEffect(() => {
    if (metricOptions.length === 0) {
      return;
    }
    if (!metricOptions.some((option) => option.key === metric)) {
      setMetric(metricOptions[0].key);
    }
  }, [metric, metricOptions]);

  const availableDayToHours = useMemo(() => {
    const index = new Map<string, Set<string>>();
    if (!originalData) {
      return index;
    }
    for (const feature of originalData.features) {
      const props = getFeatureProperties(feature);
      const startDate = parseFeatureStartDate(props);
      if (!startDate) {
        continue;
      }
      const wh = props.windowHours;
      const currentWindowHours = typeof wh === "number" ? wh : Number(wh);
      if (!Number.isFinite(currentWindowHours) || currentWindowHours !== selectedWindowHours) {
        continue;
      }
      const day = toUtcDayKey(startDate);
      const hour = `${startDate.getUTCHours()}`.padStart(2, "0");
      if (!index.has(day)) {
        index.set(day, new Set<string>());
      }
      index.get(day)?.add(hour);
    }
    return index;
  }, [originalData, selectedWindowHours]);

  const availableDays = useMemo(() => Array.from(availableDayToHours.keys()).sort(), [availableDayToHours]);
  const availableHours = useMemo(() => {
    const set = availableDayToHours.get(selectedDay);
    return set ? Array.from(set).sort((a, b) => Number(a) - Number(b)) : [];
  }, [availableDayToHours, selectedDay]);

  useEffect(() => {
    if (availableDays.length === 0) {
      setSelectedDay("");
      return;
    }
    if (!selectedDay || !availableDays.includes(selectedDay)) {
      setSelectedDay(availableDays[0]);
    }
  }, [availableDays, selectedDay]);

  useEffect(() => {
    if (availableHours.length === 0) {
      setSelectedHourStart("");
      return;
    }
    if (!selectedHourStart || !availableHours.includes(selectedHourStart)) {
      setSelectedHourStart(availableHours[0]);
    }
  }, [availableHours, selectedHourStart]);

  const selectedDateTime = useMemo(() => {
    if (!selectedDay || !selectedHourStart) {
      return null;
    }
    return fromIsoLocalInput(`${selectedDay}T${selectedHourStart}:00`);
  }, [selectedDay, selectedHourStart]);

  const dateError = useMemo(() => {
    if (loading) {
      return null;
    }
    if (!originalData) {
      return null;
    }
    if (availableDays.length === 0) {
      return "Aucune periode exploitable n'a ete trouvee dans les donnees.";
    }
    if (!selectedDay || !selectedHourStart) {
      return "Selectionne un jour et une heure disponibles.";
    }
    if (!selectedDateTime) {
      return "Selection temporelle invalide.";
    }
    return null;
  }, [availableDays.length, loading, originalData, selectedDay, selectedHourStart, selectedDateTime]);

  const filteredFeatures = useMemo(() => {
    if (!originalData) {
      return [];
    }
    if (!selectedDateTime || dateError) {
      return [];
    }
    const selectedHourWindow = selectedWindowHours;
    return originalData.features.filter((feature) => {
      const props = getFeatureProperties(feature);
      const startDate = parseFeatureStartDate(props);
      if (!startDate) {
        return false;
      }
      const wh = props.windowHours;
      const currentWindowHours = typeof wh === "number" ? wh : Number(wh);
      if (!Number.isFinite(currentWindowHours) || currentWindowHours !== selectedHourWindow) {
        return false;
      }
      const endDate = new Date(startDate.getTime() + currentWindowHours * 60 * 60 * 1000);
      if (selectedDateTime < startDate) {
        return false;
      }
      if (selectedDateTime >= endDate) {
        return false;
      }
      return true;
    });
  }, [dateError, originalData, selectedDateTime, selectedWindowHours]);

  const measureCountByFeature = useMemo(() => {
    const counts = new Map<string, number>();
    for (const feature of filteredFeatures) {
      const key = getFeatureKey(feature);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filteredFeatures]);

  const metricValues = useMemo(() => {
    if (!metric) {
      return [];
    }
    return filteredFeatures
      .map((feature) => {
        const props = getFeatureProperties(feature);
        return toNumberValue(props[metric]);
      })
      .filter((value): value is number => value !== null);
  }, [filteredFeatures, metric]);

  const colorScale = useMemo(() => buildColorScale(metricValues), [metricValues]);

  const lineWidthScale = useMemo(() => {
    const counts = Array.from(measureCountByFeature.values());
    return buildWeightScale(counts);
  }, [measureCountByFeature]);

  const metricSummary = useMemo(() => {
    if (metricValues.length === 0) {
      return null;
    }
    const min = Math.min(...metricValues);
    const max = Math.max(...metricValues);
    const avg = metricValues.reduce((sum, value) => sum + value, 0) / metricValues.length;
    return { min, max, avg };
  }, [metricValues]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !originalData || dateError) {
      return;
    }
    if (geoLayerRef.current) {
      geoLayerRef.current.removeFrom(map);
      geoLayerRef.current = null;
    }
    const layer = L.geoJSON(
      { type: "FeatureCollection", features: filteredFeatures } as GeoJSON.FeatureCollection,
      {
        style: (feature) => {
          const props = isFeatureProperties(feature?.properties) ? feature.properties : {};
          const metricValue = toNumberValue(props[metric]);
          const featureKey = getFeatureKey(feature as DashboardFeature);
          const measureCount = measureCountByFeature.get(featureKey) ?? 1;
          return {
            color: colorScale(metricValue),
            weight: lineWidthScale(measureCount),
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
          };
        },
        onEachFeature: (feature, featureLayer) => {
          featureLayer.bindTooltip(buildTooltipHtml(feature as DashboardFeature), {
            sticky: true,
            opacity: 0.98,
            direction: "top",
            className: "floatingcar-tooltip",
          });
          featureLayer.on("mouseover", () => {
            const pathLayer = featureLayer as L.Path;
            if (typeof pathLayer.bringToFront === "function") {
              pathLayer.bringToFront();
            }
          });
        },
      },
    );
    layer.addTo(map);
    geoLayerRef.current = layer;
    if (filteredFeatures.length > 0) {
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    }
  }, [colorScale, dateError, filteredFeatures, lineWidthScale, measureCountByFeature, metric, originalData]);

  const totalFeatures = originalData?.features.length ?? 0;
  const keptFeatures = filteredFeatures.length;
  const keptPct = totalFeatures > 0 ? (keptFeatures / totalFeatures) * 100 : 0;
  const activePeriod = `Periode ${preset}, jour ${selectedDay || "-"}, debut ${selectedHourStart || "--"}:00 UTC`;
  const selectedMetricLabel = metricOptions.find((option) => option.key === metric)?.label || formatLabel(metric);

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.top}>
        <div className={styles.headerBlock}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
          {error ? <p className="muted">{error}</p> : null}
        </div>
        <button className={styles.back} onClick={() => navigate("/dashboardhome")}>
          Retour au dashboard home
        </button>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterRow}>
          <div className={styles.filterLabel}>Periode active</div>
          <div className={styles.filterButtons}>
            <button className={preset === "1h" ? styles.filterButtonActive : styles.filterButton} onClick={() => setPreset("1h")}>1h</button>
            <button className={preset === "2h" ? styles.filterButtonActive : styles.filterButton} onClick={() => setPreset("2h")}>2h</button>
            <button className={preset === "3h" ? styles.filterButtonActive : styles.filterButton} onClick={() => setPreset("3h")}>3h</button>
          </div>
        </div>
        <div className={styles.filterRow}>
          <label className={styles.filterLabel}>
            Jour disponible (UTC)
            <select className={styles.searchInput} value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)}>
              {availableDays.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterLabel}>
            Heure de debut disponible (UTC)
            <select
              className={styles.searchInput}
              value={selectedHourStart}
              onChange={(e) => setSelectedHourStart(e.target.value)}
            >
              {availableHours.map((hour) => (
                <option key={hour} value={hour}>
                  {hour}:00
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterLabel}>
            Metrique couleur
            <select
              className={styles.searchInput}
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              disabled={metricOptions.length === 0}
            >
              {metricOptions.length === 0 ? (
                <option value="">Aucune mesure numerique</option>
              ) : (
                metricOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label} ({option.count})
                  </option>
                ))
              )}
            </select>
          </label>
          {dateError ? <div className={styles.mutedSmall}>{dateError}</div> : null}
        </div>
      </div>

      <div className={styles.stats}>
        <article className={styles.stat}>
          <span className={styles.statValue}>{totalFeatures}</span>
          <div className={styles.statLabel}>features totales</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{keptFeatures}</span>
          <div className={styles.statLabel}>features apres filtre date</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{keptPct.toFixed(1)}%</span>
          <div className={styles.statLabel}>pourcentage conserve</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{selectedMetricLabel}</span>
          <div className={styles.statLabel}>mesure couleur</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{metricSummary ? formatNumber(metricSummary.avg, metric) : "N/A"}</span>
          <div className={styles.statLabel}>valeur moyenne</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{activePeriod}</span>
          <div className={styles.statLabel}>periode active</div>
        </article>
      </div>

      <div className={styles.surface}>
        <div className={styles.mapWrap}>
          <div id="floating-map" className={styles.map} />
          <div className={styles.mapBadge}>
            <span className={styles.mapBadgeLabel}>Couleur</span>
            <strong>{selectedMetricLabel}</strong>
            <span className={styles.mapBadgeMeta}>
              {metricSummary
                ? `${formatNumber(metricSummary.min, metric)} - ${formatNumber(metricSummary.max, metric)}`
                : "aucune valeur numerique"}
            </span>
          </div>
          <div className={styles.mapBadgeSecondary}>
            <span className={styles.mapBadgeLabel}>Largeur</span>
            <strong>Nombre de mesures sur le troncon</strong>
          </div>
        </div>
      </div>
      <p className={styles.footerHint}>
        {metricOptions.length > 0
          ? `Mesures detectees: ${metricOptions.map((option) => option.label).join(", ")}.`
          : "Aucune mesure numerique n'a ete detectee dans les donnees chargees."}
      </p>
      {loading ? <p className={styles.footerHint}>Chargement des donnees...</p> : null}
    </div>
  );
}
