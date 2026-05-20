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

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
};

type DatePreset = "1h" | "2h" | "3h";

function parseFeatureStartDate(properties: Record<string, unknown>): Date | null {
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

function toIsoLocalInput(value: Date): string {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${value.getUTCDate()}`.padStart(2, "0");
  const hour = `${value.getUTCHours()}`.padStart(2, "0");
  const minute = `${value.getUTCMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function fromIsoLocalInput(value: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  const [selectedDateTimeInput, setSelectedDateTimeInput] = useState<string>("");
  const [metric, setMetric] = useState<string>("congestionRatio");
  const [dateError, setDateError] = useState<string | null>(null);

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
          const now = new Date();
          setSelectedDateTimeInput(toIsoLocalInput(now));
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

  const selectedDateTime = useMemo(
    () => fromIsoLocalInput(selectedDateTimeInput),
    [selectedDateTimeInput],
  );

  const filteredFeatures = useMemo(() => {
    if (!originalData) {
      return [];
    }
    if (!selectedDateTime) {
      setDateError("Selectionne une date et une heure.");
      return [];
    }
    setDateError(null);
    const selectedHourWindow = preset === "1h" ? 1 : preset === "2h" ? 2 : 3;
    return originalData.features.filter((feature) => {
      const props = (feature.properties || {}) as Record<string, unknown>;
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
  }, [originalData, selectedDateTime, preset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !originalData || dateError) {
      return;
    }
    if (geoLayerRef.current) {
      geoLayerRef.current.removeFrom(map);
      geoLayerRef.current = null;
    }
    const valueRange = filteredFeatures
      .map((f) => (f.properties as Record<string, unknown>)?.[metric])
      .filter((v): v is number => typeof v === "number");
    const min = valueRange.length > 0 ? Math.min(...valueRange) : 0;
    const max = valueRange.length > 0 ? Math.max(...valueRange) : 1;

    const layer = L.geoJSON(
      { type: "FeatureCollection", features: filteredFeatures } as GeoJSON.FeatureCollection,
      {
        style: (feature) => {
          const v = (feature?.properties as Record<string, unknown>)?.[metric];
          const ratio = typeof v === "number" && max > min ? (v - min) / (max - min) : 0.5;
          const r = Math.round(30 + ratio * 220);
          const b = Math.round(230 - ratio * 180);
          return { color: `rgb(${r},60,${b})`, weight: 3, opacity: 0.9 };
        },
      },
    );
    layer.addTo(map);
    geoLayerRef.current = layer;
    if (filteredFeatures.length > 0) {
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    }
  }, [filteredFeatures, originalData, metric, dateError]);

  const totalFeatures = originalData?.features.length ?? 0;
  const keptFeatures = filteredFeatures.length;
  const keptPct = totalFeatures > 0 ? (keptFeatures / totalFeatures) * 100 : 0;
  const activePeriod = `Periode ${preset} a la date ${selectedDateTimeInput || "-"} (UTC)`;

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

      <div className={styles.filters}>
        <div className={styles.filterRow}>
          <div className={styles.filterLabel}>Periode active: {activePeriod}</div>
          <div className={styles.filterButtons}>
            <button className={preset === "1h" ? styles.filterButtonActive : styles.filterButton} onClick={() => setPreset("1h")}>1h</button>
            <button className={preset === "2h" ? styles.filterButtonActive : styles.filterButton} onClick={() => setPreset("2h")}>2h</button>
            <button className={preset === "3h" ? styles.filterButtonActive : styles.filterButton} onClick={() => setPreset("3h")}>3h</button>
          </div>
        </div>
        <div className={styles.filterRow}>
          <label className={styles.filterLabel}>
            Date et heure (UTC)
            <input
              className={styles.searchInput}
              type="datetime-local"
              value={selectedDateTimeInput}
              onChange={(e) => setSelectedDateTimeInput(e.target.value)}
            />
          </label>
          <label className={styles.filterLabel}>
            Metrique couleur
            <select className={styles.searchInput} value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="congestionRatio">congestionRatio</option>
              <option value="meanSpeedKmh">meanSpeedKmh</option>
              <option value="speedLossPct">speedLossPct</option>
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
          <span className={styles.statValue}>{activePeriod}</span>
          <div className={styles.statLabel}>periode active</div>
        </article>
      </div>

      <div className={styles.surface}>
        <div id="floating-map" className={styles.map} />
      </div>
      {loading ? <p className={styles.footerHint}>Chargement des donnees...</p> : null}
    </div>
  );
}
