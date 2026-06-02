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

type MetricDefinition = {
  key: string;
  label: string;
  aliases: string[];
};

type DetailDefinition = {
  key: string;
  label: string;
  aliases: string[];
};

type DashboardFeature = GeoJsonFeatureCollection["features"][number];

const HERE_METRICS: MetricDefinition[] = [
  { key: "toSpdLim", label: "to Spd Lim", aliases: ["toSpdLim", "to_spd_lim", "to spd lim"] },
  { key: "availableObs", label: "available Obs", aliases: ["availableObs", "available_obs", "available obs"] },
  { key: "confidenceMin", label: "confidence Min", aliases: ["confidenceMin", "confidence_min", "confidence min"] },
  { key: "congestionRatio", label: "congestion Ratio", aliases: ["congestionRatio", "congestion_ratio", "congestion ratio"] },
  { key: "countMean", label: "count Mean", aliases: ["countMean", "count_mean", "count mean"] },
  { key: "coverageRatio", label: "coverage Ratio", aliases: ["coverageRatio", "coverage_ratio", "coverage ratio"] },
  { key: "delayDocFormula", label: "delay Doc Formula", aliases: ["delayDocFormula", "delay_doc_formula", "delay doc formula"] },
  { key: "delayMinOnLink", label: "delay Min On Link", aliases: ["delayMinOnLink", "delay_min_on_link", "delay min on link"] },
  { key: "delayMinPerKm", label: "delay Min Per Km", aliases: ["delayMinPerKm", "delay_min_per_km", "delay min per km"] },
  { key: "expectedObs", label: "expected Obs", aliases: ["expectedObs", "expected_obs", "expected obs"] },
  { key: "freeFlowKmh", label: "free Flow Kmh", aliases: ["freeFlowKmh", "free_flow_kmh", "free flow kmh"] },
  { key: "meanSpeedKmh", label: "mean Speed Kmh", aliases: ["meanSpeedKmh", "mean_speed_kmh", "mean speed kmh"] },
  { key: "pct10", label: "pct10", aliases: ["pct10"] },
  { key: "pct20", label: "pct20", aliases: ["pct20"] },
  { key: "pct30", label: "pct30", aliases: ["pct30"] },
  { key: "pct40", label: "pct40", aliases: ["pct40"] },
  { key: "pct50", label: "pct50", aliases: ["pct50"] },
  { key: "pct60", label: "pct60", aliases: ["pct60"] },
  { key: "pct70", label: "pct70", aliases: ["pct70"] },
  { key: "pct80", label: "pct80", aliases: ["pct80"] },
  { key: "pct90", label: "pct90", aliases: ["pct90"] },
  { key: "speedLossKmh", label: "speed Loss Kmh", aliases: ["speedLossKmh", "speed_loss_kmh", "speed loss kmh"] },
  { key: "speedLossPct", label: "speed Loss Pct", aliases: ["speedLossPct", "speed_loss_pct", "speed loss pct"] },
  { key: "vehicleDelayMin", label: "vehicle Delay Min", aliases: ["vehicleDelayMin", "vehicle_delay_min", "vehicle delay min"] },
  { key: "windowHours", label: "window Hours", aliases: ["windowHours", "window_hours", "window hours"] },
  { key: "confidenceMean", label: "confidence Mean", aliases: ["confidenceMean", "confidence_mean", "confidence mean"] },
  { key: "congestionRatioObsFf", label: "congestion Ratio Obs Ff", aliases: ["congestionRatioObsFf", "congestion_ratio_obs_ff", "congestion ratio obs ff"] },
  { key: "countSum", label: "count Sum", aliases: ["countSum", "count_sum", "count sum"] },
  { key: "delayMinOnLinkObsFf", label: "delay Min On Link Obs Ff", aliases: ["delayMinOnLinkObsFf", "delay_min_on_link_obs_ff", "delay min on link obs ff"] },
  { key: "delayMinPerKmObsFf", label: "delay Min Per Km Obs Ff", aliases: ["delayMinPerKmObsFf", "delay_min_per_km_obs_ff", "delay min per km obs ff"] },
  { key: "freeFlowObsMaxKmh", label: "free Flow Obs Max Kmh", aliases: ["freeFlowObsMaxKmh", "free_flow_obs_max_kmh", "free flow obs max kmh"] },
  { key: "freeFlowRaw", label: "free Flow Raw", aliases: ["freeFlowRaw", "free_flow_raw", "free flow raw"] },
  { key: "lengthM", label: "length M", aliases: ["lengthM", "length_m", "length m"] },
  { key: "maxSpeedKmh", label: "max Speed Kmh", aliases: ["maxSpeedKmh", "max_speed_kmh", "max speed kmh"] },
  { key: "minSpeedKmh", label: "min Speed Kmh", aliases: ["minSpeedKmh", "min_speed_kmh", "min speed kmh"] },
  { key: "speedLimitKmh", label: "speed Limit Kmh", aliases: ["speedLimitKmh", "speed_limit_kmh", "speed limit kmh"] },
  { key: "speedLossKmhObsFf", label: "speed Loss Kmh Obs Ff", aliases: ["speedLossKmhObsFf", "speed_loss_kmh_obs_ff", "speed loss kmh obs ff"] },
  { key: "speedLossPctObsFf", label: "speed Loss Pct Obs Ff", aliases: ["speedLossPctObsFf", "speed_loss_pct_obs_ff", "speed loss pct obs ff"] },
  { key: "stdDevMean", label: "std Dev Mean", aliases: ["stdDevMean", "std_dev_mean", "std dev mean"] },
  { key: "vehicleDelayMinObsFf", label: "vehicle Delay Min Obs Ff", aliases: ["vehicleDelayMinObsFf", "vehicle_delay_min_obs_ff", "vehicle delay min obs ff"] },
  { key: "weightedMeanSpeedKmh", label: "weighted Mean Speed Kmh", aliases: ["weightedMeanSpeedKmh", "weighted_mean_speed_kmh", "weighted mean speed kmh"] },
  { key: "delayDocFormulaObsFf", label: "delay Doc Formula Obs Ff", aliases: ["delayDocFormulaObsFf", "delay_doc_formula_obs_ff", "delay doc formula obs ff"] },
  { key: "confidence", label: "confidence", aliases: ["confidence"] },
  { key: "count", label: "count", aliases: ["count"] },
  { key: "epoch15Min", label: "epoch15 Min", aliases: ["epoch15Min", "epoch15_min", "epoch15 min"] },
  { key: "freeFlow", label: "free Flow", aliases: ["freeFlow", "free_flow", "free flow"] },
  { key: "length", label: "length", aliases: ["length"] },
  { key: "maxVitesse", label: "max Vitesse", aliases: ["maxVitesse", "max_vitesse", "max vitesse"] },
  { key: "mean", label: "mean", aliases: ["mean"] },
  { key: "minVitesse", label: "min Vitesse", aliases: ["minVitesse", "min_vitesse", "min vitesse"] },
  { key: "spdLimit", label: "spd Limit", aliases: ["spdLimit", "spd_limit", "spd limit"] },
  { key: "stdDev", label: "std Dev", aliases: ["stdDev", "std_dev", "std dev"] },
];

const TRONCON_FIELDS: DetailDefinition[] = [
  { key: "spdLim", label: "Spd Lim", aliases: ["spdLim", "spd_lim", "spd lim", "speedLimitKmh"] },
  { key: "fromLanes", label: "from Lanes", aliases: ["fromLanes", "from_lanes", "from lanes"] },
  { key: "funcClass", label: "func Class", aliases: ["funcClass", "func_class", "func class"] },
  { key: "lAreaId", label: "l Area Id", aliases: ["lAreaId", "l_area_id", "l area id"] },
  { key: "lNumZones", label: "l Num Zones", aliases: ["lNumZones", "l_num_zones", "l num zones"] },
  { key: "lPostCode", label: "l Post Code", aliases: ["lPostCode", "l_post_code", "l post code", "lpostcode"] },
  { key: "laneCat", label: "lane Cat", aliases: ["laneCat", "lane_cat", "lane cat"] },
  { key: "lowMblty", label: "low Mblty", aliases: ["lowMblty", "low_mblty", "low mblty"] },
  { key: "nShapepnt", label: "n Shapepnt", aliases: ["nShapepnt", "n_shapepnt", "n shapepnt"] },
  { key: "nrefInId", label: "nref In Id", aliases: ["nrefInId", "nref_in_id", "nref in id"] },
  { key: "numAdRng", label: "num Ad Rng", aliases: ["numAdRng", "num_ad_rng", "num ad rng"] },
  { key: "numStnmes", label: "num Stnmes", aliases: ["numStnmes", "num_stnmes", "num stnmes"] },
  { key: "physLanes", label: "phys Lanes", aliases: ["physLanes", "phys_lanes", "phys lanes"] },
  { key: "rAreaId", label: "r Area Id", aliases: ["rAreaId", "r_area_id", "r area id"] },
  { key: "rNumZones", label: "r Num Zones", aliases: ["rNumZones", "r_num_zones", "r num zones"] },
  { key: "rPostcode", label: "r Postcode", aliases: ["rPostcode", "r_postcode", "r postcode"] },
  { key: "refInId", label: "ref In Id", aliases: ["refInId", "ref_in_id", "ref in id"] },
  { key: "speedCat", label: "speed Cat", aliases: ["speedCat", "speed_cat", "speed cat"] },
  { key: "toLanes", label: "to Lanes", aliases: ["toLanes", "to_lanes", "to lanes"] },
];

function isFeatureProperties(value: unknown): value is FeatureProperties {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function matchesDefinition(key: string, definition: { key: string; aliases: string[] }): boolean {
  const normalizedKey = normalizeKey(key);
  return [definition.key, ...definition.aliases].some((alias) => normalizeKey(alias) === normalizedKey);
}

function findValueByDefinition(
  properties: FeatureProperties,
  definition: { key: string; aliases: string[] },
): unknown {
  for (const [key, value] of Object.entries(properties)) {
    if (matchesDefinition(key, definition)) {
      return value;
    }
  }
  return undefined;
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

function formatLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number, metricKey: string): string {
  const lowerKey = metricKey.toLowerCase();
  const isCountLike = lowerKey.includes("count") || lowerKey === "count" || lowerKey.includes("epoch") || lowerKey.includes("length");
  if (Number.isInteger(value) || isCountLike) {
    return String(Math.round(value));
  }

  if (lowerKey.includes("pct") || lowerKey.includes("ratio")) {
    return value.toFixed(2);
  }

  return value.toFixed(3);
}

function discoverMetricOptions(features: DashboardFeature[]): MetricOption[] {
  const counts = new Map<string, number>();

  for (const feature of features) {
    const props = getFeatureProperties(feature);
    for (const definition of HERE_METRICS) {
      const value = findValueByDefinition(props, definition);
      const numeric = toNumberValue(value);
      if (numeric !== null) {
        counts.set(definition.key, (counts.get(definition.key) ?? 0) + 1);
      }
    }
  }

  return HERE_METRICS.filter((definition) => counts.has(definition.key)).map((definition) => ({
    key: definition.key,
    label: definition.label,
    count: counts.get(definition.key) ?? 0,
  }));
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

function getMetricValue(feature: DashboardFeature | null, metricKey: string): number | null {
  if (!feature || !metricKey) {
    return null;
  }

  const props = getFeatureProperties(feature);
  const definition = HERE_METRICS.find((entry) => entry.key === metricKey);
  if (!definition) {
    return null;
  }

  return toNumberValue(findValueByDefinition(props, definition));
}

function getSelectedMetricLabel(metricKey: string): string {
  return HERE_METRICS.find((entry) => entry.key === metricKey)?.label || formatLabel(metricKey);
}

function getFeatureTitle(feature: DashboardFeature | null): string {
  if (!feature) {
    return "Aucun troncon selectionne";
  }

  const props = getFeatureProperties(feature);
  return (
    getStringValue(props.label) ||
    getStringValue(props.name) ||
    getStringValue(props.libelle) ||
    getStringValue(props.id) ||
    getFeatureKey(feature)
  );
}

function discoverTextFields(feature: DashboardFeature | null): Array<{ label: string; value: string }> {
  if (!feature) {
    return [];
  }

  const props = getFeatureProperties(feature);

  return TRONCON_FIELDS.map((definition) => {
    const rawValue = findValueByDefinition(props, definition);
    const textValue =
      getStringValue(rawValue) ??
      (isNumericValue(rawValue) ? formatNumber(rawValue, definition.key) : null) ??
      (rawValue === null || rawValue === undefined ? null : String(rawValue));

    return {
      label: definition.label,
      value: textValue ?? "N/A",
    };
  });
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
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedHourStart, setSelectedHourStart] = useState<string>("");
  const [metric, setMetric] = useState<string>("congestionRatio");
  const [selectedFeatureKey, setSelectedFeatureKey] = useState<string>("");

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
    const set = availableDayToHours.get(selectedDate);
    return set ? Array.from(set).sort((a, b) => Number(a) - Number(b)) : [];
  }, [availableDayToHours, selectedDate]);

  useEffect(() => {
    if (availableDays.length === 0) {
      setSelectedDate("");
      return;
    }
    if (!selectedDate || !availableDays.includes(selectedDate)) {
      setSelectedDate(availableDays[0]);
    }
  }, [availableDays, selectedDate]);

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
    if (!selectedDate || !selectedHourStart) {
      return null;
    }
    return fromIsoLocalInput(`${selectedDate}T${selectedHourStart}:00`);
  }, [selectedDate, selectedHourStart]);

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
    if (!selectedDate || !selectedHourStart) {
      return "Selectionne un jour et une heure disponibles.";
    }
    if (!selectedDateTime) {
      return "Selection temporelle invalide.";
    }
    return null;
  }, [availableDays.length, loading, originalData, selectedDate, selectedHourStart, selectedDateTime]);

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

  const selectedFeature = useMemo(() => {
    if (filteredFeatures.length === 0) {
      return null;
    }
    if (selectedFeatureKey) {
      const match = filteredFeatures.find((feature) => getFeatureKey(feature) === selectedFeatureKey);
      if (match) {
        return match;
      }
    }
    return filteredFeatures[0];
  }, [filteredFeatures, selectedFeatureKey]);

  useEffect(() => {
    if (filteredFeatures.length === 0) {
      setSelectedFeatureKey("");
      return;
    }
    if (!selectedFeatureKey || !filteredFeatures.some((feature) => getFeatureKey(feature) === selectedFeatureKey)) {
      setSelectedFeatureKey(getFeatureKey(filteredFeatures[0]));
    }
  }, [filteredFeatures, selectedFeatureKey]);

  const measureCountByFeature = useMemo(() => {
    const counts = new Map<string, number>();
    for (const feature of filteredFeatures) {
      const key = getFeatureKey(feature);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filteredFeatures]);

  const metricValues = useMemo(() => {
    return filteredFeatures
      .map((feature) => getMetricValue(feature, metric))
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
          const featureItem = feature as DashboardFeature;
          const metricValue = getMetricValue(featureItem, metric);
          const featureKey = getFeatureKey(feature as DashboardFeature);
          const measureCount = measureCountByFeature.get(featureKey) ?? 1;
          const isSelected = featureKey === selectedFeatureKey;
          return {
            color: colorScale(metricValue),
            weight: lineWidthScale(measureCount) + (isSelected ? 1.8 : 0),
            opacity: isSelected ? 1 : 0.9,
            lineCap: "round",
            lineJoin: "round",
          };
        },
        onEachFeature: (feature, featureLayer) => {
          featureLayer.on("mouseover", () => {
            const pathLayer = featureLayer as L.Path;
            if (typeof pathLayer.bringToFront === "function") {
              pathLayer.bringToFront();
            }
          });
          featureLayer.on("click", () => {
            setSelectedFeatureKey(getFeatureKey(feature as DashboardFeature));
          });
        },
      },
    );
    layer.addTo(map);
    geoLayerRef.current = layer;
    if (filteredFeatures.length > 0) {
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    }
  }, [colorScale, dateError, filteredFeatures, lineWidthScale, measureCountByFeature, metric, originalData, selectedFeatureKey]);

  const totalFeatures = originalData?.features.length ?? 0;
  const keptFeatures = filteredFeatures.length;
  const keptPct = totalFeatures > 0 ? (keptFeatures / totalFeatures) * 100 : 0;
  const activePeriod = `Periode ${preset}, date ${selectedDate || "-"}, debut ${selectedHourStart || "--"}:00 UTC`;
  const selectedMetricLabel = getSelectedMetricLabel(metric);
  const selectedMetricValue = getMetricValue(selectedFeature, metric);
  const selectedTextFields = discoverTextFields(selectedFeature);

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
        <div className={styles.filterRowInline}>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Periode active</span>
            <div className={styles.filterButtons}>
              <button
                className={preset === "1h" ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setPreset("1h")}
              >
                1h
              </button>
              <button
                className={preset === "2h" ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setPreset("2h")}
              >
                2h
              </button>
              <button
                className={preset === "3h" ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setPreset("3h")}
              >
                3h
              </button>
            </div>
          </div>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Date disponible</span>
            <input
              className={styles.searchInput}
              type="date"
              min={availableDays[0]}
              max={availableDays[availableDays.length - 1]}
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </div>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Heure de debut (UTC)</span>
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
          </div>
        </div>

        <div className={styles.filterRowMetric}>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Metrique</span>
            <select
              className={styles.searchInput}
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              disabled={metricOptions.length === 0}
            >
              {metricOptions.length === 0 ? (
                <option value="">Aucune mesure HERE disponible</option>
              ) : (
                metricOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {dateError ? <div className={styles.mutedSmall}>{dateError}</div> : null}
      </div>

      <div className={styles.stats}>
        <article className={styles.stat}>
          <span className={styles.statValue}>
            {loading ? (
              <span className={styles.loadingWidget} aria-label="Chargement des donnees" role="status">
                <span className={styles.loadingSpinner} />
              </span>
            ) : (
              totalFeatures
            )}
          </span>
          <div className={styles.statLabel}>features totales</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>
            {loading ? (
              <span className={styles.loadingWidget} aria-label="Chargement des donnees" role="status">
                <span className={styles.loadingSpinner} />
              </span>
            ) : (
              keptFeatures
            )}
          </span>
          <div className={styles.statLabel}>features apres filtre date</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>
            {loading ? (
              <span className={styles.loadingWidget} aria-label="Chargement des donnees" role="status">
                <span className={styles.loadingSpinner} />
              </span>
            ) : (
              `${keptPct.toFixed(1)}%`
            )}
          </span>
          <div className={styles.statLabel}>pourcentage conserve</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>
            {loading ? (
              <span className={styles.loadingWidget} aria-label="Chargement des donnees" role="status">
                <span className={styles.loadingSpinner} />
              </span>
            ) : (
              selectedMetricLabel
            )}
          </span>
          <div className={styles.statLabel}>mesure</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>
            {loading ? (
              <span className={styles.loadingWidget} aria-label="Chargement des donnees" role="status">
                <span className={styles.loadingSpinner} />
              </span>
            ) : (
              metricSummary ? formatNumber(metricSummary.avg, metric) : "N/A"
            )}
          </span>
          <div className={styles.statLabel}>valeur moyenne</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>
            {loading ? (
              <span className={styles.loadingWidget} aria-label="Chargement des donnees" role="status">
                <span className={styles.loadingSpinner} />
              </span>
            ) : (
              activePeriod
            )}
          </span>
          <div className={styles.statLabel}>periode active</div>
        </article>
      </div>

      <div className={styles.surface}>
        <div className={styles.mapWrap}>
          <div id="floating-map" className={styles.map} />
          <div className={styles.floatingLegend}>
            <div className={styles.floatingLegendItem}>
              <span className={styles.floatingLegendSwatchColor} />
              <div className={styles.floatingLegendContent}>
                <span className={styles.floatingLegendLabel}>Metrique</span>
                <strong>{selectedMetricLabel}</strong>
              </div>
            </div>
            <div className={styles.floatingLegendItem}>
              <span className={styles.floatingLegendSwatchWidth} />
              <div className={styles.floatingLegendContent}>
                <span className={styles.floatingLegendLabel}>Largeur</span>
                <strong>Nombre de mesures sur le troncon</strong>
              </div>
            </div>
            <div className={styles.floatingLegendItem}>
              <span className={styles.floatingLegendSwatchRange} />
              <div className={styles.floatingLegendContent}>
                <span className={styles.floatingLegendLabel}>Plage</span>
                <strong>
                  {loading
                    ? "Chargement..."
                    : metricSummary
                      ? `${formatNumber(metricSummary.min, metric)} - ${formatNumber(metricSummary.max, metric)}`
                      : "Aucune valeur numerique"}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className={styles.detailPanel}>
        <div className={styles.detailHeader}>
          <div>
            <div className={styles.detailEyebrow}>Troncon selectionne</div>
            <h2 className={styles.detailTitle}>{getFeatureTitle(selectedFeature)}</h2>
          </div>
          <div className={styles.detailMetricBox}>
            <span className={styles.detailMetricLabel}>{selectedMetricLabel}</span>
            {loading ? (
              <span className={styles.loadingWidget} aria-label="Chargement des donnees" role="status">
                <span className={styles.loadingSpinner} />
              </span>
            ) : (
              <strong className={styles.detailMetricValue}>
                {selectedMetricValue !== null ? formatNumber(selectedMetricValue, metric) : "N/A"}
              </strong>
            )}
          </div>
        </div>

        <div className={styles.detailGrid}>
          {selectedTextFields.map((item) => (
            <div key={item.label} className={styles.detailItem}>
              <div className={styles.detailItemLabel}>{item.label}</div>
              <div className={styles.detailItemValue}>{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <p className={styles.footerHint}>
        {metricOptions.length > 0
          ? `Mesures HERE detectees: ${metricOptions.map((option) => option.label).join(", ")}.`
          : "Aucune mesure HERE n'a ete detectee dans les donnees chargees."}
      </p>
      {loading ? <p className={styles.footerHint}>Chargement des donnees...</p> : null}
    </div>
  );
}
