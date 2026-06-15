import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchDashboardBySlug, fetchSqlViewRows } from "../api/client";
import styles from "./Dashboard.module.css";

const DEFAULT_TITLE = "Dashboard ceremap3d";
const DEFAULT_DESCRIPTION =
  "Grande carte multicouches pour explorer les panneaux, les emprises et les informations associees issues de Ceremap3D.";

const SQL_VIEW_SLUG_CANDIDATES = Array.from(
  new Set(
    [
      (import.meta.env.VITE_CEREMAP3D_SQLVIEW_SLUG as string | undefined)?.trim(),
      "CEREMAP3D_total_query",
      "ceremap3d_total_query",
    ].filter((value): value is string => Boolean(value)),
  ),
);

const MEDIA_BASE_URL = (
  (import.meta.env.VITE_CEREMAP3D_MEDIA_BASE_URL as string | undefined)?.trim() ||
  (import.meta.env.VITE_MEDIA_BASE_URL as string | undefined)?.trim() ||
  ""
).replace(/\/+$/, "");

const PANEL_COLOR = "#1f78ff";
const PANEL_ACTIVE_COLOR = "#ef7d00";
const VITESSE_COLOR = "#2f8f6a";
const DEPASSEMENT_COLOR = "#cc355f";
const PLO_COLOR = "#7a4cff";
const EMPTY_FEATURES: DashboardFeature[] = [];
const STACK_RADIUS_DEGREES = 0.00016;
const SQL_VIEW_PAGE_SIZE = 200;

type FeatureProperties = Record<string, unknown>;
type LayerKey = "panels" | "vitesse" | "depassement" | "plo";

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<
    GeoJSON.Feature<GeoJSON.Geometry | null, FeatureProperties> & {
      id?: string | number;
      properties?: FeatureProperties;
    }
  >;
};

type DashboardFeature = GeoJsonFeatureCollection["features"][number];

type CeremapRecord = {
  key: string;
  title: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  scope: string;
  category: string;
  typePanneauCode: string;
  typePanneauLabel: string;
  typePanneauActuel: string;
  typePanneauParDecision: string;
  typeEmprise: string;
  route: string;
  cote: string;
  couloir: string;
  largeur: number | null;
  hauteur: number | null;
  firstImagePath: string | null;
  imageUrl: string | null;
  vehicleType: string;
  absPrNegD: string;
  absPrPosD: string;
  hasDecision: boolean;
  hasPresignalisation: boolean;
  pointGeometry: GeoJSON.Point | null;
  vitesseGeometry: GeoJSON.Geometry | null;
  depassementGeometry: GeoJSON.Geometry | null;
  rawProperties: FeatureProperties;
  updatedAt: string | null;
  siteKey: string | null;
  siteDisplayLabel: string;
  isPlo: boolean;
};

type LayerVisibility = Record<LayerKey, boolean>;
type MeasurePoint = { latlng: L.LatLng; label: string };

function isFeatureProperties(value: unknown): value is FeatureProperties {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeNullishString(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (["none", "null", "undefined", "nan"].includes(trimmed.toLowerCase())) {
    return null;
  }

  return trimmed;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesAlias(key: string, aliases: string[]): boolean {
  const normalizedKey = normalizeKey(key);
  return aliases.some((alias) => normalizeKey(alias) === normalizedKey);
}

function getStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeNullishString(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  return null;
}

function toBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "oui", "yes"].includes(normalized);
  }
  return false;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeNullishString(value);
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGeoJsonGeometry(value: unknown): GeoJSON.Geometry | null {
  if (!value) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as GeoJSON.Geometry;
    return candidate.type ? candidate : null;
  }
  if (typeof value === "string") {
    const normalized = normalizeNullishString(value);
    if (!normalized) {
      return null;
    }
    try {
      const parsed = JSON.parse(normalized) as GeoJSON.Geometry;
      return parsed?.type ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function getFeatureProperties(feature: DashboardFeature): FeatureProperties {
  return isFeatureProperties(feature.properties) ? feature.properties : {};
}

function rowToFeature(row: FeatureProperties): DashboardFeature {
  const pointGeometry = parseGeoJsonGeometry(row.localisation_geojson);
  return {
    type: "Feature",
    id: getStringValue(row.entity_id) || getStringValue(row.id) || undefined,
    geometry: pointGeometry,
    properties: row,
  };
}

function findPropertyValue(properties: FeatureProperties, aliases: string[]): unknown {
  for (const [key, value] of Object.entries(properties)) {
    if (matchesAlias(key, aliases)) {
      return value;
    }
  }
  return undefined;
}

function formatDateValue(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("fr-FR");
}

function formatDistance(valueInMeters: number | null): string {
  if (valueInMeters === null) {
    return "N/A";
  }
  if (valueInMeters >= 1000) {
    return `${(valueInMeters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(valueInMeters)} m`;
}

function formatSize(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(2)} m`;
}

function resolveImageUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }
  if (/^(https?:|data:|blob:)/i.test(path)) {
    return path;
  }
  if (path.startsWith("/")) {
    return path;
  }
  const normalized = path.replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
  return MEDIA_BASE_URL ? `${MEDIA_BASE_URL}/${normalized}` : normalized;
}

function getFeatureKey(feature: DashboardFeature): string {
  const properties = getFeatureProperties(feature);
  const candidates = [
    findPropertyValue(properties, ["entity_id", "id", "objectid", "gid"]),
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

function getPointGeometry(feature: DashboardFeature, properties: FeatureProperties): GeoJSON.Point | null {
  const geometry =
    parseGeoJsonGeometry(feature.geometry) ||
    parseGeoJsonGeometry(findPropertyValue(properties, ["localisation_geojson"]));

  if (geometry?.type === "Point") {
    return geometry;
  }

  return null;
}

function getSiteKey(pointGeometry: GeoJSON.Point | null): string | null {
  if (!pointGeometry) {
    return null;
  }
  const [lon, lat] = pointGeometry.coordinates;
  return `${lat.toFixed(6)}|${lon.toFixed(6)}`;
}

function getSiteDisplayLabel(pointGeometry: GeoJSON.Point | null): string {
  if (!pointGeometry) {
    return "Aucune localisation";
  }
  const [lon, lat] = pointGeometry.coordinates;
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function mapFeatureToRecord(feature: DashboardFeature): CeremapRecord {
  const properties = getFeatureProperties(feature);
  const pointGeometry = getPointGeometry(feature, properties);
  const entityId = getStringValue(findPropertyValue(properties, ["entity_id", "id"])) || getFeatureKey(feature);
  const entityType =
    getStringValue(findPropertyValue(properties, ["entity_type", "type"])) ||
    feature.geometry?.type ||
    "Inconnu";
  const category = getStringValue(findPropertyValue(properties, ["categorie"])) || "N/A";
  const typePanneauCode =
    getStringValue(findPropertyValue(properties, ["type_type_panneau", "typePanneau"])) || "N/A";
  const typePanneauLabel =
    getStringValue(findPropertyValue(properties, ["description_type_panneau"])) || "N/A";
  const pointTitle =
    getStringValue(findPropertyValue(properties, ["description_type_panneau"])) ||
    typePanneauCode ||
    entityId;
  const firstImagePath = getStringValue(findPropertyValue(properties, ["first_image_path"]));
  const isPlo = /plo|bornepostale|borne postale/i.test(
    [
      entityType,
      category,
      typePanneauCode,
      typePanneauLabel,
      getStringValue(findPropertyValue(properties, ["nomPloDeb"])) || "",
      getStringValue(findPropertyValue(properties, ["nomPloFin"])) || "",
    ].join(" "),
  );

  return {
    key: getFeatureKey(feature),
    title: pointTitle,
    tenantId: getStringValue(findPropertyValue(properties, ["tenant_id", "tenant"])) || "N/A",
    entityType,
    entityId,
    scope: getStringValue(findPropertyValue(properties, ["scope"])) || "N/A",
    category,
    typePanneauCode,
    typePanneauLabel,
    typePanneauActuel: getStringValue(findPropertyValue(properties, ["type_panneau_actuel"])) || "N/A",
    typePanneauParDecision: getStringValue(findPropertyValue(properties, ["type_panneau_pardecision"])) || "N/A",
    typeEmprise: getStringValue(findPropertyValue(properties, ["type_emprise"])) || "N/A",
    route: getStringValue(findPropertyValue(properties, ["route"])) || "N/A",
    cote: getStringValue(findPropertyValue(properties, ["cote"])) || "N/A",
    couloir: getStringValue(findPropertyValue(properties, ["couloir"])) || "N/A",
    largeur: toNumberValue(findPropertyValue(properties, ["largeur"])),
    hauteur: toNumberValue(findPropertyValue(properties, ["hauteur"])),
    firstImagePath,
    imageUrl: resolveImageUrl(firstImagePath),
    vehicleType: getStringValue(findPropertyValue(properties, ["type_vehicule_emprise"])) || "N/A",
    absPrNegD: getStringValue(findPropertyValue(properties, ["absPrNegD"])) || "N/A",
    absPrPosD: getStringValue(findPropertyValue(properties, ["absPrPosD"])) || "N/A",
    hasDecision: toBooleanValue(findPropertyValue(properties, ["pardecision_et_apourdecision"])),
    hasPresignalisation: toBooleanValue(findPropertyValue(properties, ["aPourPresignalisation"])),
    pointGeometry,
    vitesseGeometry: parseGeoJsonGeometry(findPropertyValue(properties, ["localisation_geojson_vitesse"])),
    depassementGeometry: parseGeoJsonGeometry(findPropertyValue(properties, ["localisation_geojson_depassement"])),
    rawProperties: properties,
    updatedAt:
      getStringValue(findPropertyValue(properties, ["updated_at"])) ||
      getStringValue(findPropertyValue(properties, ["created_at"])),
    siteKey: getSiteKey(pointGeometry),
    siteDisplayLabel: getSiteDisplayLabel(pointGeometry),
    isPlo,
  };
}

function recordMatchesSearch(record: CeremapRecord, searchValue: string): boolean {
  const normalizedSearch = searchValue.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  const values = Object.values(record.rawProperties)
    .map((value) => getStringValue(value) || "")
    .join(" ");
  return [
    record.entityId,
    record.entityType,
    record.category,
    record.typePanneauCode,
    record.typePanneauLabel,
    record.route,
    record.scope,
    record.tenantId,
    values,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedSearch);
}

function buildOffsetLatLng(baseLatLng: L.LatLng, index: number, total: number): L.LatLng {
  if (total <= 1) {
    return baseLatLng;
  }
  const angle = (Math.PI * 2 * index) / total;
  const latOffset = Math.sin(angle) * STACK_RADIUS_DEGREES;
  const lonOffset = Math.cos(angle) * STACK_RADIUS_DEGREES;
  return L.latLng(baseLatLng.lat + latOffset, baseLatLng.lng + lonOffset);
}

function createSiteOffsets(records: CeremapRecord[], expandedSiteKey: string | null): Map<string, L.LatLng> {
  const result = new Map<string, L.LatLng>();
  const groups = new Map<string, CeremapRecord[]>();

  for (const record of records) {
    if (!record.siteKey || !record.pointGeometry) {
      continue;
    }
    if (!groups.has(record.siteKey)) {
      groups.set(record.siteKey, []);
    }
    groups.get(record.siteKey)?.push(record);
  }

  for (const group of groups.values()) {
    const first = group[0];
    if (!first.pointGeometry) {
      continue;
    }
    const [lon, lat] = first.pointGeometry.coordinates;
    const baseLatLng = L.latLng(lat, lon);
    const shouldExpand = first.siteKey !== null && first.siteKey === expandedSiteKey && group.length > 1;
    group.forEach((record, index) => {
      result.set(record.key, shouldExpand ? buildOffsetLatLng(baseLatLng, index, group.length) : baseLatLng);
    });
  }

  return result;
}

function computeBounds(records: CeremapRecord[], visibility: LayerVisibility, pointOffsets: Map<string, L.LatLng>): L.LatLngBounds | null {
  const bounds = L.latLngBounds([]);

  for (const record of records) {
    if (visibility.panels) {
      const point = pointOffsets.get(record.key);
      if (point) {
        bounds.extend(point);
      }
    }
    if (visibility.vitesse && record.vitesseGeometry) {
      const layer = L.geoJSON(record.vitesseGeometry as GeoJSON.GeoJsonObject);
      const geometryBounds = layer.getBounds();
      if (geometryBounds.isValid()) {
        bounds.extend(geometryBounds);
      }
    }
    if (visibility.depassement && record.depassementGeometry) {
      const layer = L.geoJSON(record.depassementGeometry as GeoJSON.GeoJsonObject);
      const geometryBounds = layer.getBounds();
      if (geometryBounds.isValid()) {
        bounds.extend(geometryBounds);
      }
    }
  }

  return bounds.isValid() ? bounds : null;
}

function createMeasureLabel(index: number): string {
  return index === 0 ? "A" : index === 1 ? "B" : String(index + 1);
}

function getNearestSnapPoint(map: L.Map, clickLatLng: L.LatLng, records: CeremapRecord[], pointOffsets: Map<string, L.LatLng>): L.LatLng {
  const clickPoint = map.latLngToContainerPoint(clickLatLng);
  let best: { latlng: L.LatLng; distance: number } | null = null;

  for (const record of records) {
    const point = pointOffsets.get(record.key);
    if (!point) {
      continue;
    }
    const containerPoint = map.latLngToContainerPoint(point);
    const distance = clickPoint.distanceTo(containerPoint);
    if (!best || distance < best.distance) {
      best = { latlng: point, distance };
    }
  }

  if (best && best.distance <= 20) {
    return best.latlng;
  }

  return clickLatLng;
}

async function fetchCeremap3DRowsPage(
  page: number,
): Promise<{ slug: string; totalRows: number; features: DashboardFeature[] }> {
  let lastError: Error | null = null;

  for (const slug of SQL_VIEW_SLUG_CANDIDATES) {
    try {
      const data = await fetchSqlViewRows<FeatureProperties>(slug, { page, pageSize: SQL_VIEW_PAGE_SIZE });
      return { slug, totalRows: data.totalRows, features: data.items.map((item) => rowToFeature(item)) };
    } catch (caughtError) {
      lastError = caughtError instanceof Error ? caughtError : new Error("Echec de chargement de la SQL view.");
    }
  }

  throw lastError ?? new Error("Aucune SQL view Ceremap3D disponible.");
}

export function DashboardCeremap3D() {
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const dataLayerRef = useRef<L.LayerGroup | null>(null);
  const measureLayerRef = useRef<L.LayerGroup | null>(null);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [sqlViewSlug, setSqlViewSlug] = useState<string>(SQL_VIEW_SLUG_CANDIDATES[0] ?? "CEREMAP3D_total_query");
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadedRows, setLoadedRows] = useState(0);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allFeatures, setAllFeatures] = useState<DashboardFeature[]>(EMPTY_FEATURES);
  const [selectedRecordKey, setSelectedRecordKey] = useState("");
  const [selectedTenant, setSelectedTenant] = useState("all");
  const [selectedScope, setSelectedScope] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedTypeCode, setSelectedTypeCode] = useState("all");
  const [selectedRoute, setSelectedRoute] = useState("all");
  const [searchValue, setSearchValue] = useState("");
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    panels: true,
    vitesse: true,
    depassement: true,
    plo: true,
  });
  const [measureMode, setMeasureMode] = useState(false);
  const [snapToPanels, setSnapToPanels] = useState(true);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [expandedSiteKey, setExpandedSiteKey] = useState<string | null>(null);
  const [hasAdjustedView, setHasAdjustedView] = useState(false);

  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map("ceremap3d-map", { zoomControl: false }).setView([46.6, 2.2], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(mapRef.current);
      L.control.zoom({ position: "topright" }).addTo(mapRef.current);
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
        setLoading(true);
        setIsStreaming(false);
        setLoadedRows(0);
        setTotalRows(null);
        setAllFeatures(EMPTY_FEATURES);

        const [dashboardResult, firstPageResult] = await Promise.allSettled([
          fetchDashboardBySlug("ceremap3d"),
          fetchCeremap3DRowsPage(1),
        ]);

        if (cancelled) {
          return;
        }

        if (dashboardResult.status === "fulfilled") {
          setTitle(dashboardResult.value.title || DEFAULT_TITLE);
          setDescription(dashboardResult.value.description || DEFAULT_DESCRIPTION);
        }

        if (firstPageResult.status === "rejected") {
          throw firstPageResult.reason;
        }

        setSqlViewSlug(firstPageResult.value.slug);
        setTotalRows(firstPageResult.value.totalRows);
        setAllFeatures(firstPageResult.value.features);
        setLoadedRows(firstPageResult.value.features.length);
        setError(null);
        setLoading(false);

        const totalPages = Math.ceil(firstPageResult.value.totalRows / SQL_VIEW_PAGE_SIZE);
        if (totalPages > 1) {
          setIsStreaming(true);
        }

        for (let page = 2; page <= totalPages; page += 1) {
          const pageResult = await fetchCeremap3DRowsPage(page);
          if (cancelled) {
            return;
          }
          setAllFeatures((current) => [...current, ...pageResult.features]);
          setLoadedRows((current) => current + pageResult.features.length);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        setIsStreaming(false);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger la vue Ceremap3D.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsStreaming(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);
  const allRecords = useMemo(() => allFeatures.map((feature) => mapFeatureToRecord(feature)), [allFeatures]);

  const availableTenants = useMemo(
    () => Array.from(new Set(allRecords.map((record) => record.tenantId).filter((value) => value !== "N/A"))).sort(),
    [allRecords],
  );
  const availableScopes = useMemo(
    () => Array.from(new Set(allRecords.map((record) => record.scope).filter((value) => value !== "N/A"))).sort(),
    [allRecords],
  );
  const availableCategories = useMemo(
    () => Array.from(new Set(allRecords.map((record) => record.category).filter((value) => value !== "N/A"))).sort(),
    [allRecords],
  );
  const availableTypeCodes = useMemo(
    () => Array.from(new Set(allRecords.map((record) => record.typePanneauCode).filter((value) => value !== "N/A"))).sort(),
    [allRecords],
  );
  const availableRoutes = useMemo(
    () => Array.from(new Set(allRecords.map((record) => record.route).filter((value) => value !== "N/A"))).sort(),
    [allRecords],
  );

  const filteredRecords = useMemo(() => {
    return allRecords.filter((record) => {
      if (selectedTenant !== "all" && record.tenantId !== selectedTenant) {
        return false;
      }
      if (selectedScope !== "all" && record.scope !== selectedScope) {
        return false;
      }
      if (selectedCategory !== "all" && record.category !== selectedCategory) {
        return false;
      }
      if (selectedTypeCode !== "all" && record.typePanneauCode !== selectedTypeCode) {
        return false;
      }
      if (selectedRoute !== "all" && record.route !== selectedRoute) {
        return false;
      }
      return recordMatchesSearch(record, searchValue);
    });
  }, [
    allRecords,
    searchValue,
    selectedCategory,
    selectedRoute,
    selectedScope,
    selectedTenant,
    selectedTypeCode,
  ]);

  const siteGroups = useMemo(() => {
    const groups = new Map<
      string,
      { siteKey: string; records: CeremapRecord[]; baseLatLng: L.LatLng }
    >();

    for (const record of filteredRecords) {
      if (!record.siteKey || !record.pointGeometry) {
        continue;
      }
      const existing = groups.get(record.siteKey);
      if (existing) {
        existing.records.push(record);
        continue;
      }
      const [lon, lat] = record.pointGeometry.coordinates;
      groups.set(record.siteKey, {
        siteKey: record.siteKey,
        records: [record],
        baseLatLng: L.latLng(lat, lon),
      });
    }

    return Array.from(groups.values());
  }, [filteredRecords]);

  const pointOffsets = useMemo(
    () => createSiteOffsets(filteredRecords, expandedSiteKey),
    [expandedSiteKey, filteredRecords],
  );

  const selectedRecord = useMemo(() => {
    if (filteredRecords.length === 0) {
      return null;
    }
    const match = filteredRecords.find((record) => record.key === selectedRecordKey);
    return match ?? filteredRecords[0];
  }, [filteredRecords, selectedRecordKey]);

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setSelectedRecordKey("");
      setExpandedSiteKey(null);
      return;
    }
    if (!filteredRecords.some((record) => record.key === selectedRecordKey)) {
      setSelectedRecordKey(filteredRecords[0].key);
    }
  }, [filteredRecords, selectedRecordKey]);

  useEffect(() => {
    if (!expandedSiteKey) {
      return;
    }
    if (!siteGroups.some((group) => group.siteKey === expandedSiteKey && group.records.length > 1)) {
      setExpandedSiteKey(null);
    }
  }, [expandedSiteKey, siteGroups]);

  useEffect(() => {
    if (!expandedSiteKey || !selectedRecord?.siteKey) {
      return;
    }
    if (selectedRecord.siteKey !== expandedSiteKey) {
      setExpandedSiteKey(null);
    }
  }, [expandedSiteKey, selectedRecord]);

  const recordsAtSameSite = useMemo(() => {
    if (!selectedRecord?.siteKey) {
      return selectedRecord ? [selectedRecord] : [];
    }
    return filteredRecords.filter((record) => record.siteKey === selectedRecord.siteKey);
  }, [filteredRecords, selectedRecord]);

  const nearestRecords = useMemo(() => {
    if (!selectedRecord?.pointGeometry) {
      return [];
    }

    const [selectedLon, selectedLat] = selectedRecord.pointGeometry.coordinates;
    const selectedLatLng = L.latLng(selectedLat, selectedLon);

    return filteredRecords
      .filter((record) => record.key !== selectedRecord.key && record.pointGeometry)
      .map((record) => {
        const [lon, lat] = record.pointGeometry!.coordinates;
        const distance = selectedLatLng.distanceTo(L.latLng(lat, lon));
        return { record, distance };
      })
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 10);
  }, [filteredRecords, selectedRecord]);

  const vitesseCount = useMemo(
    () => filteredRecords.filter((record) => record.vitesseGeometry !== null).length,
    [filteredRecords],
  );
  const depassementCount = useMemo(
    () => filteredRecords.filter((record) => record.depassementGeometry !== null).length,
    [filteredRecords],
  );
  const duplicateSiteCount = useMemo(() => {
    const counts = new Map<string, number>();
    filteredRecords.forEach((record) => {
      if (!record.siteKey) {
        return;
      }
      counts.set(record.siteKey, (counts.get(record.siteKey) ?? 0) + 1);
    });
    return Array.from(counts.values()).filter((count) => count > 1).length;
  }, [filteredRecords]);
  const ploCount = useMemo(
    () => filteredRecords.filter((record) => record.isPlo).length,
    [filteredRecords],
  );

  const latestUpdate = useMemo(() => {
    const timestamps = filteredRecords
      .map((record) => record.updatedAt)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()));
    if (timestamps.length === 0) {
      return null;
    }
    return new Date(Math.max(...timestamps.map((value) => value.getTime()))).toISOString();
  }, [filteredRecords]);

  const measureDistance = useMemo(() => {
    if (measurePoints.length < 2) {
      return null;
    }
    return measurePoints[0].latlng.distanceTo(measurePoints[1].latlng);
  }, [measurePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const handler = (event: L.LeafletMouseEvent) => {
      if (!measureMode) {
        return;
      }
      const latlng = snapToPanels
        ? getNearestSnapPoint(map, event.latlng, filteredRecords, pointOffsets)
        : event.latlng;

      setMeasurePoints((current) => {
        const next = current.length >= 2 ? [] : current;
        return [...next, { latlng, label: createMeasureLabel(next.length) }];
      });
    };

    map.on("click", handler);
    map.getContainer().style.cursor = measureMode ? "crosshair" : "";

    return () => {
      map.off("click", handler);
      map.getContainer().style.cursor = "";
    };
  }, [filteredRecords, measureMode, pointOffsets, snapToPanels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (dataLayerRef.current) {
      dataLayerRef.current.removeFrom(map);
      dataLayerRef.current = null;
    }

    const dataLayer = L.layerGroup();

    if (layerVisibility.panels) {
      siteGroups.forEach((group) => {
        const visibleGroupRecords = group.records.filter((record) => layerVisibility.plo || !record.isPlo);
        if (visibleGroupRecords.length === 0) {
          return;
        }

        const isExpanded = expandedSiteKey === group.siteKey && visibleGroupRecords.length > 1;

        if (!isExpanded) {
          const representative =
            selectedRecord && visibleGroupRecords.some((record) => record.key === selectedRecord.key)
              ? selectedRecord
              : visibleGroupRecords[0];
          const markerColor = representative.isPlo ? PLO_COLOR : PANEL_COLOR;
          const marker = L.circleMarker(group.baseLatLng, {
            radius: visibleGroupRecords.length > 1 ? 11 : 8,
            fillColor: representative.key === selectedRecord?.key ? PANEL_ACTIVE_COLOR : markerColor,
            color: "#ffffff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.94,
          });
          const tooltipText =
            visibleGroupRecords.length > 1
              ? `${visibleGroupRecords.length} panneaux a cette localisation`
              : `${representative.typePanneauCode !== "N/A" ? representative.typePanneauCode : representative.entityType} - ${representative.title}`;
          marker.bindTooltip(tooltipText, { direction: "top", offset: [0, -8] });
          marker.on("click", () => {
            setSelectedRecordKey(representative.key);
            if (visibleGroupRecords.length > 1) {
              setExpandedSiteKey(group.siteKey);
            } else {
              setExpandedSiteKey(null);
            }
          });
          dataLayer.addLayer(marker);

          if (visibleGroupRecords.length > 1) {
            const countLabel = L.marker(group.baseLatLng, {
              interactive: false,
              icon: L.divIcon({
                className: styles.mapCountBadge,
                html: `<span>${visibleGroupRecords.length}</span>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
              }),
            });
            dataLayer.addLayer(countLabel);
          }
        } else {
          visibleGroupRecords.forEach((record) => {
            const isSelected = record.key === selectedRecord?.key;
            const displayLatLng = pointOffsets.get(record.key) || group.baseLatLng;
            const markerColor = record.isPlo ? PLO_COLOR : isSelected ? PANEL_ACTIVE_COLOR : PANEL_COLOR;
            const marker = L.circleMarker(displayLatLng, {
              radius: isSelected ? 9 : 7,
              fillColor: markerColor,
              color: "#ffffff",
              weight: isSelected ? 2.5 : 1.5,
              opacity: 1,
              fillOpacity: 0.92,
            });
            marker.bindTooltip(
              `${record.typePanneauCode !== "N/A" ? record.typePanneauCode : record.entityType} - ${record.title}`,
              { direction: "top", offset: [0, -8] },
            );
            marker.on("click", () => {
              setSelectedRecordKey(record.key);
            });
            dataLayer.addLayer(marker);
          });
        }
      });
    }

    filteredRecords.forEach((record) => {
      const isSelected = record.key === selectedRecord?.key;

      if (layerVisibility.vitesse && record.vitesseGeometry) {
        const vitesseLayer = L.geoJSON(record.vitesseGeometry as GeoJSON.GeoJsonObject, {
          style: {
            color: VITESSE_COLOR,
            weight: isSelected ? 5.2 : 3.2,
            opacity: isSelected ? 1 : 0.72,
          },
        });
        vitesseLayer.on("click", () => setSelectedRecordKey(record.key));
        dataLayer.addLayer(vitesseLayer);
      }

      if (layerVisibility.depassement && record.depassementGeometry) {
        const depassementLayer = L.geoJSON(record.depassementGeometry as GeoJSON.GeoJsonObject, {
          style: {
            color: DEPASSEMENT_COLOR,
            dashArray: "8 6",
            weight: isSelected ? 5.2 : 3.2,
            opacity: isSelected ? 1 : 0.72,
          },
        });
        depassementLayer.on("click", () => setSelectedRecordKey(record.key));
        dataLayer.addLayer(depassementLayer);
      }
    });

    dataLayer.addTo(map);
    dataLayerRef.current = dataLayer;

    if (!hasAdjustedView) {
      const bounds = computeBounds(filteredRecords, layerVisibility, pointOffsets);
      if (bounds) {
        map.fitBounds(bounds, { padding: [26, 26] });
        setHasAdjustedView(true);
      }
    }
  }, [expandedSiteKey, filteredRecords, hasAdjustedView, layerVisibility, pointOffsets, selectedRecord, siteGroups]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (measureLayerRef.current) {
      measureLayerRef.current.removeFrom(map);
      measureLayerRef.current = null;
    }

    const measureLayer = L.layerGroup();

    measurePoints.forEach((point) => {
      const marker = L.circleMarker(point.latlng, {
        radius: 7,
        fillColor: "#101828",
        color: "#ffffff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.96,
      });
      marker.bindTooltip(point.label, { permanent: true, direction: "top", offset: [0, -8] });
      measureLayer.addLayer(marker);
    });

    if (measurePoints.length === 2) {
      const line = L.polyline(measurePoints.map((point) => point.latlng), {
        color: "#101828",
        weight: 3,
        dashArray: "6 6",
      });
      measureLayer.addLayer(line);
    }

    measureLayer.addTo(map);
    measureLayerRef.current = measureLayer;
  }, [measurePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedRecord?.pointGeometry) {
      return;
    }

    const [lon, lat] = selectedRecord.pointGeometry.coordinates;
    const targetLatLng =
      pointOffsets.get(selectedRecord.key) || L.latLng(lat, lon);

    map.panTo(targetLatLng, { animate: true, duration: 0.5 });
  }, [pointOffsets, selectedRecord]);

  const detailItems = useMemo(() => {
    if (!selectedRecord) {
      return [];
    }
    return [
      { label: "Entity ID", value: selectedRecord.entityId },
      { label: "Type d'entite", value: selectedRecord.entityType },
      { label: "Categorie", value: selectedRecord.category },
      { label: "Code panneau", value: selectedRecord.typePanneauCode },
      { label: "Description panneau", value: selectedRecord.typePanneauLabel },
      { label: "Type actuel", value: selectedRecord.typePanneauActuel },
      { label: "Type par decision", value: selectedRecord.typePanneauParDecision },
      { label: "Route", value: selectedRecord.route },
      { label: "Couloir", value: selectedRecord.couloir },
      { label: "Cote", value: selectedRecord.cote },
      { label: "Tenant", value: selectedRecord.tenantId },
      { label: "Scope", value: selectedRecord.scope },
      { label: "Largeur", value: formatSize(selectedRecord.largeur) },
      { label: "Hauteur", value: formatSize(selectedRecord.hauteur) },
      { label: "Emprise", value: selectedRecord.typeEmprise },
      { label: "Vehicule", value: selectedRecord.vehicleType },
      { label: "Abs PR Neg D", value: selectedRecord.absPrNegD },
      { label: "Abs PR Pos D", value: selectedRecord.absPrPosD },
      { label: "Decision", value: selectedRecord.hasDecision ? "Oui" : "Non" },
      { label: "Presignalisation", value: selectedRecord.hasPresignalisation ? "Oui" : "Non" },
      { label: "Localisation", value: selectedRecord.siteDisplayLabel },
      { label: "Derniere mise a jour", value: formatDateValue(selectedRecord.updatedAt) },
    ];
  }, [selectedRecord]);

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
            <span className={styles.filterLabel}>Recherche</span>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="entity id, code panneau, route, scope, categorie"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
            />
          </div>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Categorie</span>
            <select className={styles.searchInput} value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="all">Toutes</option>
              {availableCategories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Code panneau</span>
            <select className={styles.searchInput} value={selectedTypeCode} onChange={(event) => setSelectedTypeCode(event.target.value)}>
              <option value="all">Tous</option>
              {availableTypeCodes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.filterRowInline}>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Tenant</span>
            <select className={styles.searchInput} value={selectedTenant} onChange={(event) => setSelectedTenant(event.target.value)}>
              <option value="all">Tous</option>
              {availableTenants.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Scope</span>
            <select className={styles.searchInput} value={selectedScope} onChange={(event) => setSelectedScope(event.target.value)}>
              <option value="all">Tous</option>
              {availableScopes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterBlock}>
            <span className={styles.filterLabel}>Route</span>
            <select className={styles.searchInput} value={selectedRoute} onChange={(event) => setSelectedRoute(event.target.value)}>
              <option value="all">Toutes</option>
              {availableRoutes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className={styles.stats}>
        <article className={styles.stat}>
          <span className={styles.statValue}>{loading ? "..." : filteredRecords.length}</span>
          <div className={styles.statLabel}>panneaux visibles</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>
            {loading ? "..." : totalRows !== null ? `${loadedRows}/${totalRows}` : loadedRows}
          </span>
          <div className={styles.statLabel}>lignes chargees</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{loading ? "..." : vitesseCount}</span>
          <div className={styles.statLabel}>emprises vitesse</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{loading ? "..." : depassementCount}</span>
          <div className={styles.statLabel}>emprises depassement</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{loading ? "..." : duplicateSiteCount}</span>
          <div className={styles.statLabel}>sites multi-panneaux</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{loading ? "..." : formatDateValue(latestUpdate)}</span>
          <div className={styles.statLabel}>derniere mise a jour detectee</div>
        </article>
      </div>

      <div className={`${styles.surface} ${styles.surfaceInteractive}`}>
        <div className={styles.mapWrap}>
          <div id="ceremap3d-map" className={`${styles.map} ${styles.mapLarge}`} />

          <div className={styles.mapBadge}>
            <span className={styles.mapBadgeLabel}>Couches</span>
            <div className={styles.layerGrid}>
              <button
                className={layerVisibility.panels ? styles.layerToggleActive : styles.layerToggle}
                onClick={() => setLayerVisibility((current) => ({ ...current, panels: !current.panels }))}
              >
                Panneaux
              </button>
              <button
                className={layerVisibility.vitesse ? styles.layerToggleActive : styles.layerToggle}
                onClick={() => setLayerVisibility((current) => ({ ...current, vitesse: !current.vitesse }))}
              >
                Emprise vitesse
              </button>
              <button
                className={layerVisibility.depassement ? styles.layerToggleActive : styles.layerToggle}
                onClick={() => setLayerVisibility((current) => ({ ...current, depassement: !current.depassement }))}
              >
                Emprise depassement
              </button>
              <button
                className={layerVisibility.plo ? styles.layerToggleActive : styles.layerToggle}
                onClick={() => setLayerVisibility((current) => ({ ...current, plo: !current.plo }))}
                disabled={ploCount === 0}
              >
                PLO {ploCount > 0 ? `(${ploCount})` : "(absent)"}
              </button>
            </div>
          </div>

          <div className={styles.mapBadgeSecondary}>
            <span className={styles.mapBadgeLabel}>Mesure</span>
            <div className={styles.measureControls}>
              <button
                className={measureMode ? styles.filterButtonActive : styles.filterButton}
                onClick={() => {
                  setMeasureMode((current) => !current);
                  setMeasurePoints([]);
                }}
              >
                {measureMode ? "Desactiver" : "Activer"}
              </button>
              <button
                className={snapToPanels ? styles.filterButtonActive : styles.filterButton}
                onClick={() => setSnapToPanels((current) => !current)}
              >
                Aimantation
              </button>
              <button className={styles.filterButton} onClick={() => setMeasurePoints([])}>
                Reinitialiser
              </button>
            </div>
            <div className={styles.mapBadgeMeta}>
              {measureMode ? "Cliquez sur deux points pour mesurer la distance a vol d'oiseau." : "Mode de mesure inactif."}
            </div>
            <strong>{measureDistance === null ? "Aucune mesure" : formatDistance(measureDistance)}</strong>
          </div>

          <div className={styles.floatingLegend}>
            <div className={styles.floatingLegendItem}>
              <span className={styles.floatingLegendSwatchColor} style={{ background: PANEL_COLOR }} />
              <div className={styles.floatingLegendContent}>
                <span className={styles.floatingLegendLabel}>Panneaux</span>
                <strong>{filteredRecords.length} points visibles</strong>
              </div>
            </div>
            <div className={styles.floatingLegendItem}>
              <span className={styles.floatingLegendSwatchWidth} style={{ background: VITESSE_COLOR }} />
              <div className={styles.floatingLegendContent}>
                <span className={styles.floatingLegendLabel}>Emprises</span>
                <strong>{vitesseCount} vitesse, {depassementCount} depassement</strong>
              </div>
            </div>
            <div className={styles.floatingLegendItem}>
              <span className={styles.floatingLegendSwatchRange} />
              <div className={styles.floatingLegendContent}>
                <span className={styles.floatingLegendLabel}>Vue source</span>
                <strong>{sqlViewSlug}</strong>
              </div>
            </div>
          </div>
        </div>

        <aside className={styles.sidePanel}>
          <h3 className={styles.panelInfoTitle}>Panneau selectionne</h3>
          {selectedRecord ? (
            <>
              <div className={styles.selectedSummary}>
                <strong>{selectedRecord.typePanneauCode !== "N/A" ? selectedRecord.typePanneauCode : selectedRecord.entityType}</strong>
                <span>{selectedRecord.title}</span>
                <span>{selectedRecord.siteDisplayLabel}</span>
              </div>
              <dl className={styles.panelInfoList}>
                {detailItems.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className={styles.mutedSmall}>Aucun panneau visible avec les filtres actifs.</p>
          )}

          {recordsAtSameSite.length > 1 ? (
            <>
              <h3 className={styles.panelInfoTitle}>Meme localisation ({recordsAtSameSite.length})</h3>
              <div className={styles.contentList}>
                {recordsAtSameSite.map((record) => (
                  <button
                    key={record.key}
                    className={record.key === selectedRecord?.key ? styles.contentRowActive : styles.contentRow}
                    onClick={() => setSelectedRecordKey(record.key)}
                  >
                    <strong>{record.typePanneauCode}</strong>
                    <span>{record.title}</span>
                    <span>{record.entityId}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {nearestRecords.length > 0 ? (
            <>
              <h3 className={styles.panelInfoTitle}>10 points les plus proches</h3>
              <div className={styles.contentList}>
                {nearestRecords.map(({ record, distance }) => (
                  <button
                    key={record.key}
                    className={record.key === selectedRecord?.key ? styles.contentRowActive : styles.contentRow}
                    onClick={() => setSelectedRecordKey(record.key)}
                  >
                    <strong>{record.typePanneauCode !== "N/A" ? record.typePanneauCode : record.entityType}</strong>
                    <span>{record.title}</span>
                    <span>{formatDistance(distance)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <h3 className={styles.panelInfoTitle}>Liste rapide</h3>
          <div className={styles.contentList}>
            {filteredRecords.slice(0, 80).map((record) => (
              <button
                key={record.key}
                className={record.key === selectedRecord?.key ? styles.contentRowActive : styles.contentRow}
                onClick={() => setSelectedRecordKey(record.key)}
              >
                <strong>{record.typePanneauCode !== "N/A" ? record.typePanneauCode : record.entityType}</strong>
                <span>{record.title}</span>
                <span>{record.route}</span>
              </button>
            ))}
            {filteredRecords.length > 80 ? (
              <p className={styles.mutedSmall}>+ {filteredRecords.length - 80} panneaux supplementaires</p>
            ) : null}
          </div>
        </aside>
      </div>

      <p className={styles.footerHint}>
        Couches disponibles: panneaux, emprises vitesse, emprises depassement
        {ploCount > 0 ? `, PLO (${ploCount})` : ". Aucun objet PLO exploitable n'a ete detecte dans cette vue."}
      </p>
      <p className={styles.footerHint}>
        {loading
          ? "Chargement initial de la vue Ceremap3D..."
          : isStreaming
            ? `Chargement progressif en cours: ${loadedRows}/${totalRows ?? loadedRows} lignes.`
            : `Chargement termine: ${loadedRows}/${totalRows ?? loadedRows} lignes.`}
      </p>
    </div>
  );
}
