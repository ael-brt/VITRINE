import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchDashboardBySlug, fetchSqlViewRows } from "../api/client";
import styles from "./Dashboard.module.css";

const DEFAULT_TITLE = "Dashboard ceremap3d";
const DEFAULT_DESCRIPTION =
  "Grande carte multicouches pour explorer les panneaux, les emprises et les informations associees issues de Ceremap3D.";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1").replace(/\/+$/, "");

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
const VITESSE_COLOR = "#2f8f6a";
const DEPASSEMENT_COLOR = "#cc355f";
const PLO_COLOR = "#7a4cff";
const PANEL_CATEGORY_COLORS = ["#1f78ff", "#ef7d00", "#2f8f6a", "#cc355f", "#7a4cff", "#0f766e", "#b45309", "#7c3aed"];
const EMPTY_FEATURES: DashboardFeature[] = [];
const STACK_RADIUS_DEGREES = 0.00016;
const SQL_VIEW_PAGE_SIZE = 200;

const BASEMAPS = {
  plan: {
    label: "Plan",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  orthophoto: {
    label: "Orthophoto",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
} as const;

type FeatureProperties = Record<string, unknown>;
type LayerKey = "panels" | "vitesse" | "depassement" | "plo";
type BasemapKey = keyof typeof BASEMAPS;

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
  sourceKind: "panel" | "vitesse" | "depassement" | "other";
  title: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  scope: string;
  category: string;
  catireveCategory: string;
  typePanneauCode: string;
  typePanneauLabel: string;
  gammePanneau: string;
  positionPanneau: string;
  ploDebut: string;
  arreteNecessaire: string;
  typePanneauActuel: string;
  typePanneauParDecision: string;
  typeEmprise: string;
  route: string;
  cote: string;
  couloir: string;
  pdfFilename: string;
  panonceaux: string;
  largeur: number | null;
  hauteur: number | null;
  firstImagePath: string | null;
  imageUrl: string | null;
  vehicleType: string;
  absPrNegD: string;
  absPrPosD: string;
  hasDecision: boolean;
  hasDecisionLabel: string;
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

type RecordDetailColumn = {
  label: string;
  getValue: (record: CeremapRecord) => string;
};

type TableSortDirection = "asc" | "desc";

type TableSortState = {
  label: string;
  direction: TableSortDirection;
} | null;

type LayerVisibility = Record<LayerKey, boolean>;
type MeasurePoint = { latlng: L.LatLng; label: string };
type FilterSectionKey = "signalisation" | "implantation" | "arretes" | "affichage";
type FilterKey =
  | "catireveCategory"
  | "typePanneau"
  | "gammePanneau"
  | "positionPanneau"
  | "route"
  | "cote"
  | "ploDebut"
  | "arreteNecessaire"
  | "typeEmprise"
  | "pdfFilename"
  | "panonceaux"
  | "vehicleType"
  | "decisionAttachment";

type FilterState = Record<FilterKey, string>;
type PanelCategoryIconKind = "interdiction" | "obligation" | "danger" | "indication" | "service" | "direction" | "temporary" | "generic";
type PanelCategoryStyle = {
  key: string;
  label: string;
  color: string;
  iconKind: PanelCategoryIconKind;
  emoji: string;
  symbolUrl: string | null;
};

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

function getTypeActuelValue(record: CeremapRecord): string {
  return record.typePanneauLabel !== "N/A"
    ? record.typePanneauActuel !== "N/A"
      ? `${record.typePanneauActuel} - ${record.typePanneauLabel}`
      : record.typePanneauLabel
    : record.typePanneauActuel;
}

const RECORD_DETAIL_COLUMNS: RecordDetailColumn[] = [
  { label: "Entity ID", getValue: (record) => record.entityId },
  { label: "Type d'entite", getValue: (record) => record.entityType },
  { label: "Categorie", getValue: (record) => record.category },
  { label: "Code panneau", getValue: (record) => record.typePanneauCode },
  { label: "Description panneau", getValue: (record) => record.typePanneauLabel },
  { label: "Type actuel", getValue: (record) => getTypeActuelValue(record) },
  { label: "Type par decision", getValue: (record) => record.typePanneauParDecision },
  { label: "Route", getValue: (record) => record.route },
  { label: "Couloir", getValue: (record) => record.couloir },
  { label: "Cote", getValue: (record) => record.cote },
  { label: "Tenant", getValue: (record) => record.tenantId },
  { label: "Scope", getValue: (record) => record.scope },
  { label: "Largeur", getValue: (record) => formatSize(record.largeur) },
  { label: "Hauteur", getValue: (record) => formatSize(record.hauteur) },
  { label: "Emprise", getValue: (record) => record.typeEmprise },
  { label: "Vehicule", getValue: (record) => record.vehicleType },
  { label: "Abs PR Neg D", getValue: (record) => record.absPrNegD },
  { label: "Abs PR Pos D", getValue: (record) => record.absPrPosD },
  { label: "Decision", getValue: (record) => (record.hasDecision ? "Oui" : "Non") },
  { label: "Presignalisation", getValue: (record) => (record.hasPresignalisation ? "Oui" : "Non") },
  { label: "Localisation", getValue: (record) => record.siteDisplayLabel },
  { label: "Derniere mise a jour", getValue: (record) => formatDateValue(record.updatedAt) },
];

function getRecordDetailItems(record: CeremapRecord): Array<{ label: string; value: string }> {
  return RECORD_DETAIL_COLUMNS.map((column) => ({
    label: column.label,
    value: column.getValue(record),
  }));
}

const tableSortCollator = new Intl.Collator("fr-FR", {
  numeric: true,
  sensitivity: "base",
});

function compareTableValues(left: string, right: string): number {
  const normalizedLeft = left === "N/A" ? "" : left;
  const normalizedRight = right === "N/A" ? "" : right;

  if (!normalizedLeft && !normalizedRight) {
    return 0;
  }
  if (!normalizedLeft) {
    return 1;
  }
  if (!normalizedRight) {
    return -1;
  }

  return tableSortCollator.compare(normalizedLeft, normalizedRight);
}

function resolveImageUrl(entityId: string, path: string | null): string | null {
  if (!entityId || !path) {
    return null;
  }
  if (/^(https?:|data:|blob:)/i.test(path)) {
    return path;
  }
  const normalized = path.replace(/^(\.\.\/)+/, "").replace(/^\/+/, "").replace(/\\/g, "/");
  if (MEDIA_BASE_URL) {
    return `${MEDIA_BASE_URL}/${normalized}`;
  }
  const searchParams = new URLSearchParams({ entity_id: entityId });
  return `${API_BASE_URL}/datahub/ceremap3d/panel-image/?${searchParams.toString()}`;
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
  const normalizedEntityType = normalizeKey(entityType);
  const sourceKind =
    normalizedEntityType === "panneau"
      ? "panel"
      : normalizedEntityType === "emprisevitesse"
        ? "vitesse"
        : normalizedEntityType === "emprisedepass"
          ? "depassement"
          : "other";
  const category = getStringValue(findPropertyValue(properties, ["categorie"])) || "N/A";
  const catireveCategory =
    getStringValue(findPropertyValue(properties, ["type_panneau_catireve"])) ||
    category;
  const typePanneauCode =
    getStringValue(findPropertyValue(properties, ["type_type_panneau", "typePanneau"])) || "N/A";
  const typePanneauLabel =
    getStringValue(findPropertyValue(properties, ["description_type_panneau"])) || "N/A";
  const gammePanneau =
    getStringValue(
      findPropertyValue(properties, ["gamme_panneau", "apourgamme_gamme", "aPourGamme_gamme", "gamme"]),
    ) || "N/A";
  const positionPanneau =
    getStringValue(findPropertyValue(properties, ["apourgeocodage_couloir", "couloir"])) || "N/A";
  const ploDebut =
    getStringValue(findPropertyValue(properties, ["nomplodeb", "nomPloDeb"])) || "N/A";
  const arreteNecessaire =
    getStringValue(findPropertyValue(properties, ["apourtype_pardecision", "type_panneau_pardecision"])) || "N/A";
  const typeEmprise = getStringValue(findPropertyValue(properties, ["type_emprise"])) || "N/A";
  const pointTitle =
    sourceKind === "panel"
      ? getStringValue(findPropertyValue(properties, ["description_type_panneau"])) ||
        typePanneauCode ||
        entityId
      : typeEmprise !== "N/A"
        ? typeEmprise
        : getStringValue(findPropertyValue(properties, ["description_type_panneau"])) || entityId;
  const firstImagePath = getStringValue(findPropertyValue(properties, ["first_image_path"]));
  const pdfFilename =
    getStringValue(findPropertyValue(properties, ["pdf_filename"])) || "N/A";
  const panonceaux =
    getStringValue(findPropertyValue(properties, ["panonceaux"])) || "N/A";
  const hasDecision = toBooleanValue(findPropertyValue(properties, ["pardecision_et_apourdecision"]));
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
    sourceKind,
    title: pointTitle,
    tenantId: getStringValue(findPropertyValue(properties, ["tenant_id", "tenant"])) || "N/A",
    entityType,
    entityId,
    scope: getStringValue(findPropertyValue(properties, ["scope"])) || "N/A",
    category,
    catireveCategory,
    typePanneauCode,
    typePanneauLabel,
    gammePanneau,
    positionPanneau,
    ploDebut,
    arreteNecessaire,
    typePanneauActuel: getStringValue(findPropertyValue(properties, ["type_panneau_actuel"])) || "N/A",
    typePanneauParDecision: getStringValue(findPropertyValue(properties, ["type_panneau_pardecision"])) || "N/A",
    typeEmprise,
    route: getStringValue(findPropertyValue(properties, ["route"])) || "N/A",
    cote: getStringValue(findPropertyValue(properties, ["cote"])) || "N/A",
    couloir: getStringValue(findPropertyValue(properties, ["couloir"])) || "N/A",
    pdfFilename,
    panonceaux,
    largeur: toNumberValue(findPropertyValue(properties, ["largeur"])),
    hauteur: toNumberValue(findPropertyValue(properties, ["hauteur"])),
    firstImagePath,
    imageUrl: sourceKind === "panel" ? resolveImageUrl(entityId, firstImagePath) : null,
    vehicleType: getStringValue(findPropertyValue(properties, ["type_vehicule_emprise"])) || "N/A",
    absPrNegD: getStringValue(findPropertyValue(properties, ["absPrNegD"])) || "N/A",
    absPrPosD: getStringValue(findPropertyValue(properties, ["absPrPosD"])) || "N/A",
    hasDecision,
    hasDecisionLabel: hasDecision ? "Oui" : "Non",
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
  if (index < 26) {
    return String.fromCharCode(65 + index);
  }
  return `P${index + 1}`;
}

function getFilterOptions(records: CeremapRecord[], pick: (record: CeremapRecord) => string): string[] {
  return Array.from(
    new Set(
      records
        .map(pick)
        .filter((value) => value && value !== "N/A"),
    ),
  ).sort((left, right) => left.localeCompare(right, "fr"));
}

function matchesRecordFilters(record: CeremapRecord, filters: FilterState, excludeKey?: FilterKey): boolean {
  if (excludeKey !== "catireveCategory" && filters.catireveCategory !== "all" && record.catireveCategory !== filters.catireveCategory) {
    return false;
  }
  if (excludeKey !== "typePanneau" && filters.typePanneau !== "all" && getPanelTypeFilterValue(record) !== filters.typePanneau) {
    return false;
  }
  if (excludeKey !== "gammePanneau" && filters.gammePanneau !== "all" && record.gammePanneau !== filters.gammePanneau) {
    return false;
  }
  if (excludeKey !== "positionPanneau" && filters.positionPanneau !== "all" && record.positionPanneau !== filters.positionPanneau) {
    return false;
  }
  if (excludeKey !== "route" && filters.route !== "all" && record.route !== filters.route) {
    return false;
  }
  if (excludeKey !== "cote" && filters.cote !== "all" && record.cote !== filters.cote) {
    return false;
  }
  if (excludeKey !== "ploDebut" && filters.ploDebut !== "all" && record.ploDebut !== filters.ploDebut) {
    return false;
  }
  if (excludeKey !== "arreteNecessaire" && filters.arreteNecessaire !== "all" && record.arreteNecessaire !== filters.arreteNecessaire) {
    return false;
  }
  if (excludeKey !== "typeEmprise" && filters.typeEmprise !== "all" && record.typeEmprise !== filters.typeEmprise) {
    return false;
  }
  if (excludeKey !== "pdfFilename" && filters.pdfFilename !== "all" && record.pdfFilename !== filters.pdfFilename) {
    return false;
  }
  if (excludeKey !== "panonceaux" && filters.panonceaux !== "all" && record.panonceaux !== filters.panonceaux) {
    return false;
  }
  if (excludeKey !== "vehicleType" && filters.vehicleType !== "all" && record.vehicleType !== filters.vehicleType) {
    return false;
  }
  if (excludeKey !== "decisionAttachment" && filters.decisionAttachment !== "all" && record.hasDecisionLabel !== filters.decisionAttachment) {
    return false;
  }
  return true;
}

function getPanelCategoryKey(record: CeremapRecord): string {
  return record.catireveCategory !== "N/A" ? record.catireveCategory : record.category;
}

function getPanelTypeFilterValue(record: CeremapRecord): string {
  if (record.typePanneauLabel && record.typePanneauLabel !== "N/A") {
    return record.typePanneauLabel;
  }
  return record.typePanneauCode;
}

function inferPanelCategoryEmoji(iconKind: PanelCategoryIconKind): string {
  switch (iconKind) {
    case "interdiction":
      return "⛔";
    case "obligation":
      return "🔵";
    case "danger":
      return "⚠️";
    case "indication":
      return "ℹ️";
    case "service":
      return "🅿️";
    case "direction":
      return "➡️";
    case "temporary":
      return "🚧";
    default:
      return "📍";
  }
}

function resolveCategorySymbolUrl(category: string): string | null {
  if (!category || category === "N/A") {
    return null;
  }
  const searchParams = new URLSearchParams({ category });
  return `${API_BASE_URL}/datahub/ceremap3d/category-symbol/?${searchParams.toString()}`;
}

function inferPanelCategoryIconKind(label: string): PanelCategoryIconKind {
  const normalized = normalizeKey(label);
  const explicitMappings: Array<{ match: string[]; iconKind: PanelCategoryIconKind }> = [
    { match: ["signauxdinterdiction", "interdiction", "prohibition"], iconKind: "interdiction" },
    { match: ["signauxdobligation", "obligation"], iconKind: "obligation" },
    { match: ["signauxdedanger", "danger"], iconKind: "danger" },
    { match: ["signauxdindication", "indication"], iconKind: "indication" },
    { match: ["signalisationdedirection", "direction", "jalonnement", "localisation"], iconKind: "direction" },
    { match: ["signauxdeservice", "service"], iconKind: "service" },
    { match: ["temporaire", "chantier", "travaux"], iconKind: "temporary" },
    { match: ["priorite", "priorité"], iconKind: "danger" },
  ];

  for (const entry of explicitMappings) {
    if (entry.match.some((item) => normalized.includes(normalizeKey(item)))) {
      return entry.iconKind;
    }
  }

  if (normalized.includes("interdiction")) {
    return "interdiction";
  }
  if (normalized.includes("obligation")) {
    return "obligation";
  }
  if (normalized.includes("danger")) {
    return "danger";
  }
  if (normalized.includes("indication")) {
    return "indication";
  }
  if (normalized.includes("service")) {
    return "service";
  }
  if (normalized.includes("direction")) {
    return "direction";
  }
  if (normalized.includes("temporaire") || normalized.includes("chantier")) {
    return "temporary";
  }
  return "generic";
}

function buildPanelMarkerHtml(style: PanelCategoryStyle, options: { selected: boolean; count?: number }): string {
  const classes = [styles.mapSymbolMarker];
  if (options.selected) {
    classes.push(styles.mapSymbolMarkerActive);
  }
  return `
    <span class="${classes.join(" ")}" style="--marker-color:${style.color};">
      ${
        style.symbolUrl
          ? `<img class="${styles.mapSymbolImage}" src="${style.symbolUrl}" alt="${style.label}" />`
          : `<span class="${styles.mapSymbolEmoji}">${style.emoji}</span>`
      }
      ${options.count && options.count > 1 ? `<span class="${styles.mapSymbolCount}">${options.count}</span>` : ""}
    </span>
  `;
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

function getEmpriseDescription(record: CeremapRecord): string {
  if (record.typeEmprise !== "N/A") {
    return record.typeEmprise;
  }
  return "Emprise sans type";
}

function getEmpriseTooltipContent(record: CeremapRecord): string {
  const parts = [getEmpriseDescription(record)];

  if (record.pdfFilename && record.pdfFilename !== "N/A") {
    parts.push(record.pdfFilename);
  }

  return parts.join(" - ");
}

function buildEmprisePopupContent(record: CeremapRecord): string {
  const rows = [
    ["Type d'emprise", record.typeEmprise],
    ["Route", record.route],
    ["Cote", record.cote],
    ["Couloir", record.couloir],
    ["Vehicule", record.vehicleType],
    ["Arrete PDF", record.pdfFilename],
    ["Rattachement", record.hasDecisionLabel],
  ].filter(([, value]) => value && value !== "N/A");

  return `
    <div style="display:grid;gap:6px;min-width:220px;">
      <strong style="font-size:13px;color:#111827;">${getEmpriseDescription(record)}</strong>
      ${rows
        .map(
          ([label, value]) =>
            `<div style="font-size:12px;line-height:1.35;"><span style="font-weight:700;color:#475467;">${label}:</span> <span style="color:#101828;">${value}</span></div>`,
        )
        .join("")}
    </div>
  `;
}

export function DashboardCeremap3D() {
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const dataLayerRef = useRef<L.LayerGroup | null>(null);
  const measureLayerRef = useRef<L.LayerGroup | null>(null);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadedRows, setLoadedRows] = useState(0);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allFeatures, setAllFeatures] = useState<DashboardFeature[]>(EMPTY_FEATURES);
  const [selectedRecordKey, setSelectedRecordKey] = useState("");
  const [selectedCatireveCategory, setSelectedCatireveCategory] = useState("all");
  const [selectedTypePanneau, setSelectedTypePanneau] = useState("all");
  const [selectedGammePanneau, setSelectedGammePanneau] = useState("all");
  const [selectedPositionPanneau, setSelectedPositionPanneau] = useState("all");
  const [selectedRoute, setSelectedRoute] = useState("all");
  const [selectedCote, setSelectedCote] = useState("all");
  const [selectedPloDebut, setSelectedPloDebut] = useState("all");
  const [selectedArreteNecessaire, setSelectedArreteNecessaire] = useState("all");
  const [selectedTypeEmprise, setSelectedTypeEmprise] = useState("all");
  const [selectedPdfFilename, setSelectedPdfFilename] = useState("all");
  const [selectedPanonceaux, setSelectedPanonceaux] = useState("all");
  const [selectedVehicleType, setSelectedVehicleType] = useState("all");
  const [selectedDecisionAttachment, setSelectedDecisionAttachment] = useState("all");
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    panels: true,
    vitesse: true,
    depassement: true,
    plo: true,
  });
  const [measureMode, setMeasureMode] = useState(false);
  const [snapToPanels, setSnapToPanels] = useState(true);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measureVisible, setMeasureVisible] = useState(true);
  const [tableSort, setTableSort] = useState<TableSortState>(null);
  const [expandedSiteKey, setExpandedSiteKey] = useState<string | null>(null);
  const [hasAdjustedView, setHasAdjustedView] = useState(false);
  const [basemap, setBasemap] = useState<BasemapKey>("orthophoto");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [filterSections, setFilterSections] = useState<Record<FilterSectionKey, boolean>>({
    signalisation: true,
    implantation: true,
    arretes: true,
    affichage: true,
  });

  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map("ceremap3d-map", {
        zoomControl: false,
        maxZoom: 24,
      }).setView([46.6, 2.2], 6);
      const initialBasemap = BASEMAPS.orthophoto;
      baseLayerRef.current = L.tileLayer(initialBasemap.url, {
        attribution: initialBasemap.attribution,
        maxZoom: 24,
      }).addTo(mapRef.current);
    }

    return () => {
      if (baseLayerRef.current) {
        baseLayerRef.current.remove();
        baseLayerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (baseLayerRef.current) {
      baseLayerRef.current.remove();
    }

    const config = BASEMAPS[basemap];
    baseLayerRef.current = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: 24,
    }).addTo(mapRef.current);
  }, [basemap]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 50);

    return () => window.clearTimeout(timer);
  }, [filtersVisible]);

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
  const allPanelRecords = useMemo(
    () => allRecords.filter((record) => record.sourceKind === "panel"),
    [allRecords],
  );
  const filterState = useMemo<FilterState>(
    () => ({
      catireveCategory: selectedCatireveCategory,
      typePanneau: selectedTypePanneau,
      gammePanneau: selectedGammePanneau,
      positionPanneau: selectedPositionPanneau,
      route: selectedRoute,
      cote: selectedCote,
      ploDebut: selectedPloDebut,
      arreteNecessaire: selectedArreteNecessaire,
      typeEmprise: selectedTypeEmprise,
      pdfFilename: selectedPdfFilename,
      panonceaux: selectedPanonceaux,
      vehicleType: selectedVehicleType,
      decisionAttachment: selectedDecisionAttachment,
    }),
    [
      selectedArreteNecessaire,
      selectedCatireveCategory,
      selectedCote,
      selectedDecisionAttachment,
      selectedGammePanneau,
      selectedPanonceaux,
      selectedPdfFilename,
      selectedPloDebut,
      selectedPositionPanneau,
      selectedRoute,
      selectedTypeEmprise,
      selectedTypePanneau,
      selectedVehicleType,
    ],
  );

  const optionSourceRecords = useMemo(
    () => ({
      catireveCategory: allPanelRecords.filter((record) => matchesRecordFilters(record, filterState, "catireveCategory")),
      typePanneau: allPanelRecords.filter((record) => matchesRecordFilters(record, filterState, "typePanneau")),
      gammePanneau: allPanelRecords.filter((record) => matchesRecordFilters(record, filterState, "gammePanneau")),
      positionPanneau: allPanelRecords.filter((record) => matchesRecordFilters(record, filterState, "positionPanneau")),
      route: allRecords.filter((record) => matchesRecordFilters(record, filterState, "route")),
      cote: allRecords.filter((record) => matchesRecordFilters(record, filterState, "cote")),
      ploDebut: allPanelRecords.filter((record) => matchesRecordFilters(record, filterState, "ploDebut")),
      arreteNecessaire: allPanelRecords.filter((record) => matchesRecordFilters(record, filterState, "arreteNecessaire")),
      typeEmprise: allRecords.filter((record) => matchesRecordFilters(record, filterState, "typeEmprise")),
      pdfFilename: allRecords.filter((record) => matchesRecordFilters(record, filterState, "pdfFilename")),
      panonceaux: allRecords.filter((record) => matchesRecordFilters(record, filterState, "panonceaux")),
      vehicleType: allRecords.filter((record) => matchesRecordFilters(record, filterState, "vehicleType")),
      decisionAttachment: allRecords.filter((record) => matchesRecordFilters(record, filterState, "decisionAttachment")),
    }),
    [allPanelRecords, allRecords, filterState],
  );

  const availableCatireveCategories = useMemo(() => getFilterOptions(optionSourceRecords.catireveCategory, (record) => record.catireveCategory), [optionSourceRecords]);
  const availableTypePanneaux = useMemo(
    () => getFilterOptions(optionSourceRecords.typePanneau, (record) => getPanelTypeFilterValue(record)),
    [optionSourceRecords],
  );
  const availableGammePanneaux = useMemo(() => getFilterOptions(optionSourceRecords.gammePanneau, (record) => record.gammePanneau), [optionSourceRecords]);
  const availablePositionPanneaux = useMemo(() => getFilterOptions(optionSourceRecords.positionPanneau, (record) => record.positionPanneau), [optionSourceRecords]);
  const availableRoutes = useMemo(() => getFilterOptions(optionSourceRecords.route, (record) => record.route), [optionSourceRecords]);
  const availableCotes = useMemo(() => getFilterOptions(optionSourceRecords.cote, (record) => record.cote), [optionSourceRecords]);
  const availablePloDebuts = useMemo(() => getFilterOptions(optionSourceRecords.ploDebut, (record) => record.ploDebut), [optionSourceRecords]);
  const availableArretesNecessaires = useMemo(() => getFilterOptions(optionSourceRecords.arreteNecessaire, (record) => record.arreteNecessaire), [optionSourceRecords]);
  const availableTypeEmprises = useMemo(() => getFilterOptions(optionSourceRecords.typeEmprise, (record) => record.typeEmprise), [optionSourceRecords]);
  const availablePdfFilenames = useMemo(() => getFilterOptions(optionSourceRecords.pdfFilename, (record) => record.pdfFilename), [optionSourceRecords]);
  const availablePanonceaux = useMemo(() => getFilterOptions(optionSourceRecords.panonceaux, (record) => record.panonceaux), [optionSourceRecords]);
  const availableVehicleTypes = useMemo(() => getFilterOptions(optionSourceRecords.vehicleType, (record) => record.vehicleType), [optionSourceRecords]);
  const availableDecisionAttachments = useMemo(() => getFilterOptions(optionSourceRecords.decisionAttachment, (record) => record.hasDecisionLabel), [optionSourceRecords]);
  const panelCategoryStyles = useMemo(() => {
    const categories = Array.from(
      new Set(
        allPanelRecords
          .map((record) => getPanelCategoryKey(record))
          .filter((value) => value && value !== "N/A"),
      ),
    ).sort((left, right) => left.localeCompare(right, "fr"));

    const entries: Array<[string, PanelCategoryStyle]> = categories.map((label, index) => [
      label,
      (() => {
        const iconKind = inferPanelCategoryIconKind(label);
        return {
          key: label,
          label,
          color: PANEL_CATEGORY_COLORS[index % PANEL_CATEGORY_COLORS.length],
          iconKind,
          emoji: inferPanelCategoryEmoji(iconKind),
          symbolUrl: resolveCategorySymbolUrl(label),
        };
      })(),
    ]);

    return new Map<string, PanelCategoryStyle>(entries);
  }, [allPanelRecords]);
  const filteredRecords = useMemo(() => {
    return allRecords.filter((record) => matchesRecordFilters(record, filterState));
  }, [allRecords, filterState]);
  const filteredPanelRecords = useMemo(
    () => filteredRecords.filter((record) => record.sourceKind === "panel"),
    [filteredRecords],
  );
  useEffect(() => {
    if (selectedCatireveCategory !== "all" && !availableCatireveCategories.includes(selectedCatireveCategory)) {
      setSelectedCatireveCategory("all");
    }
    if (selectedTypePanneau !== "all" && !availableTypePanneaux.includes(selectedTypePanneau)) {
      setSelectedTypePanneau("all");
    }
    if (selectedGammePanneau !== "all" && !availableGammePanneaux.includes(selectedGammePanneau)) {
      setSelectedGammePanneau("all");
    }
    if (selectedPositionPanneau !== "all" && !availablePositionPanneaux.includes(selectedPositionPanneau)) {
      setSelectedPositionPanneau("all");
    }
    if (selectedRoute !== "all" && !availableRoutes.includes(selectedRoute)) {
      setSelectedRoute("all");
    }
    if (selectedCote !== "all" && !availableCotes.includes(selectedCote)) {
      setSelectedCote("all");
    }
    if (selectedPloDebut !== "all" && !availablePloDebuts.includes(selectedPloDebut)) {
      setSelectedPloDebut("all");
    }
    if (selectedArreteNecessaire !== "all" && !availableArretesNecessaires.includes(selectedArreteNecessaire)) {
      setSelectedArreteNecessaire("all");
    }
    if (selectedTypeEmprise !== "all" && !availableTypeEmprises.includes(selectedTypeEmprise)) {
      setSelectedTypeEmprise("all");
    }
    if (selectedPdfFilename !== "all" && !availablePdfFilenames.includes(selectedPdfFilename)) {
      setSelectedPdfFilename("all");
    }
    if (selectedPanonceaux !== "all" && !availablePanonceaux.includes(selectedPanonceaux)) {
      setSelectedPanonceaux("all");
    }
    if (selectedVehicleType !== "all" && !availableVehicleTypes.includes(selectedVehicleType)) {
      setSelectedVehicleType("all");
    }
    if (selectedDecisionAttachment !== "all" && !availableDecisionAttachments.includes(selectedDecisionAttachment)) {
      setSelectedDecisionAttachment("all");
    }
  }, [
    availableArretesNecessaires,
    availableCatireveCategories,
    availableCotes,
    availableDecisionAttachments,
    availableGammePanneaux,
    availablePanonceaux,
    availablePdfFilenames,
    availablePloDebuts,
    availablePositionPanneaux,
    availableRoutes,
    availableTypeEmprises,
    availableTypePanneaux,
    availableVehicleTypes,
    selectedArreteNecessaire,
    selectedCatireveCategory,
    selectedCote,
    selectedDecisionAttachment,
    selectedGammePanneau,
    selectedPanonceaux,
    selectedPdfFilename,
    selectedPloDebut,
    selectedPositionPanneau,
    selectedRoute,
    selectedTypeEmprise,
    selectedTypePanneau,
    selectedVehicleType,
  ]);

  const siteGroups = useMemo(() => {
    const groups = new Map<
      string,
      { siteKey: string; records: CeremapRecord[]; baseLatLng: L.LatLng }
    >();

    for (const record of filteredPanelRecords) {
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
  }, [filteredPanelRecords]);

  const pointOffsets = useMemo(
    () => createSiteOffsets(filteredPanelRecords, expandedSiteKey),
    [expandedSiteKey, filteredPanelRecords],
  );

  const selectedRecord = useMemo(() => {
    if (filteredRecords.length === 0) {
      return null;
    }
    const match = filteredRecords.find((record) => record.key === selectedRecordKey);
    return match ?? filteredPanelRecords[0] ?? filteredRecords[0];
  }, [filteredPanelRecords, filteredRecords, selectedRecordKey]);

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
    if (!selectedRecord || selectedRecord.sourceKind !== "panel") {
      return [];
    }
    if (!selectedRecord.siteKey) {
      return [selectedRecord];
    }
    return filteredPanelRecords.filter((record) => record.siteKey === selectedRecord.siteKey);
  }, [filteredPanelRecords, selectedRecord]);

  const nearestRecords = useMemo(() => {
    if (!selectedRecord?.pointGeometry || selectedRecord.sourceKind !== "panel") {
      return [];
    }

    const [selectedLon, selectedLat] = selectedRecord.pointGeometry.coordinates;
    const selectedLatLng = L.latLng(selectedLat, selectedLon);

    return filteredPanelRecords
      .filter((record) => record.key !== selectedRecord.key && record.pointGeometry)
      .map((record) => {
        const [lon, lat] = record.pointGeometry!.coordinates;
        const distance = selectedLatLng.distanceTo(L.latLng(lat, lon));
        return { record, distance };
      })
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 10);
  }, [filteredPanelRecords, selectedRecord]);

  const vitesseCount = useMemo(
    () => filteredRecords.filter((record) => record.sourceKind === "vitesse" && record.vitesseGeometry !== null).length,
    [filteredRecords],
  );
  const depassementCount = useMemo(
    () => filteredRecords.filter((record) => record.sourceKind === "depassement" && record.depassementGeometry !== null).length,
    [filteredRecords],
  );
  const duplicateSiteCount = useMemo(() => {
    const counts = new Map<string, number>();
    filteredPanelRecords.forEach((record) => {
      if (!record.siteKey) {
        return;
      }
      counts.set(record.siteKey, (counts.get(record.siteKey) ?? 0) + 1);
    });
    return Array.from(counts.values()).filter((count) => count > 1).length;
  }, [filteredPanelRecords]);
  const ploCount = useMemo(
    () => filteredPanelRecords.filter((record) => record.isPlo).length,
    [filteredPanelRecords],
  );

  const latestUpdate = useMemo(() => {
    const timestamps = filteredPanelRecords
      .map((record) => record.updatedAt)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()));
    if (timestamps.length === 0) {
      return null;
    }
    return new Date(Math.max(...timestamps.map((value) => value.getTime()))).toISOString();
  }, [filteredPanelRecords]);

  const activeFilterCount = useMemo(() => {
    return [
      selectedCatireveCategory,
      selectedTypePanneau,
      selectedGammePanneau,
      selectedPositionPanneau,
      selectedRoute,
      selectedCote,
      selectedPloDebut,
      selectedArreteNecessaire,
      selectedTypeEmprise,
      selectedPdfFilename,
      selectedPanonceaux,
      selectedVehicleType,
      selectedDecisionAttachment,
    ].filter((value) => value !== "all").length;
  }, [
    selectedArreteNecessaire,
    selectedCatireveCategory,
    selectedCote,
    selectedDecisionAttachment,
    selectedGammePanneau,
    selectedPanonceaux,
    selectedPdfFilename,
    selectedPloDebut,
    selectedPositionPanneau,
    selectedRoute,
    selectedTypeEmprise,
    selectedTypePanneau,
    selectedVehicleType,
  ]);

  const measureDistance = useMemo(() => {
    if (measurePoints.length < 2) {
      return null;
    }
    return measurePoints.slice(1).reduce((total, point, index) => {
      return total + measurePoints[index].latlng.distanceTo(point.latlng);
    }, 0);
  }, [measurePoints]);

  const appendMeasurePoint = useCallback((latlng: L.LatLng) => {
    setMeasurePoints((current) => [...current, { latlng, label: createMeasureLabel(current.length) }]);
  }, []);

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
        ? getNearestSnapPoint(map, event.latlng, filteredPanelRecords, pointOffsets)
        : event.latlng;
      appendMeasurePoint(latlng);
    };

    map.on("click", handler);
    map.getContainer().style.cursor = measureMode ? "crosshair" : "";

    return () => {
      map.off("click", handler);
      map.getContainer().style.cursor = "";
    };
  }, [appendMeasurePoint, filteredPanelRecords, measureMode, pointOffsets, snapToPanels]);

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
          const categoryKey = getPanelCategoryKey(representative);
          const distinctCategories = new Set(
            visibleGroupRecords
              .map((record) => getPanelCategoryKey(record))
              .filter((value) => value && value !== "N/A"),
          );
          const categoryStyle: PanelCategoryStyle = representative.isPlo
            ? { key: "plo", label: "PLO", color: PLO_COLOR, iconKind: "service", emoji: "📮", symbolUrl: null }
            : distinctCategories.size > 1
              ? { key: "multi", label: "Multi-categories", color: PANEL_COLOR, iconKind: "generic", emoji: "🧩", symbolUrl: null }
              : (panelCategoryStyles.get(categoryKey) ?? {
                  key: categoryKey,
                  label: categoryKey,
                  color: PANEL_COLOR,
                  iconKind: inferPanelCategoryIconKind(categoryKey),
                  emoji: inferPanelCategoryEmoji(inferPanelCategoryIconKind(categoryKey)),
                  symbolUrl: resolveCategorySymbolUrl(categoryKey),
                });
          const marker = L.marker(group.baseLatLng, {
            icon: L.divIcon({
              className: styles.mapSymbolMarkerWrap,
              html: buildPanelMarkerHtml(categoryStyle, {
                selected: representative.key === selectedRecord?.key,
                count: visibleGroupRecords.length > 1 ? visibleGroupRecords.length : undefined,
              }),
              iconSize: [visibleGroupRecords.length > 1 ? 38 : 30, visibleGroupRecords.length > 1 ? 38 : 30],
              iconAnchor: [visibleGroupRecords.length > 1 ? 19 : 15, visibleGroupRecords.length > 1 ? 19 : 15],
            }),
          });
          const tooltipText =
            visibleGroupRecords.length > 1
              ? `${visibleGroupRecords.length} panneaux a cette localisation`
              : `${representative.typePanneauCode !== "N/A" ? representative.typePanneauCode : representative.entityType} - ${representative.title}`;
          marker.bindTooltip(tooltipText, { direction: "top", offset: [0, -8] });
          marker.on("click", () => {
            if (measureMode) {
              appendMeasurePoint(group.baseLatLng);
              return;
            }
            setSelectedRecordKey(representative.key);
            if (visibleGroupRecords.length > 1) {
              setExpandedSiteKey(group.siteKey);
            } else {
              setExpandedSiteKey(null);
            }
          });
          dataLayer.addLayer(marker);

        } else {
          visibleGroupRecords.forEach((record) => {
            const isSelected = record.key === selectedRecord?.key;
            const displayLatLng = pointOffsets.get(record.key) || group.baseLatLng;
            const categoryKey = getPanelCategoryKey(record);
            const categoryStyle: PanelCategoryStyle = record.isPlo
              ? { key: "plo", label: "PLO", color: PLO_COLOR, iconKind: "service", emoji: "📮", symbolUrl: null }
              : (panelCategoryStyles.get(categoryKey) ?? {
                  key: categoryKey,
                  label: categoryKey,
                  color: PANEL_COLOR,
                  iconKind: inferPanelCategoryIconKind(categoryKey),
                  emoji: inferPanelCategoryEmoji(inferPanelCategoryIconKind(categoryKey)),
                  symbolUrl: resolveCategorySymbolUrl(categoryKey),
                });
            const marker = L.marker(displayLatLng, {
              icon: L.divIcon({
                className: styles.mapSymbolMarkerWrap,
                html: buildPanelMarkerHtml(categoryStyle, { selected: isSelected }),
                iconSize: [isSelected ? 34 : 30, isSelected ? 34 : 30],
                iconAnchor: [isSelected ? 17 : 15, isSelected ? 17 : 15],
              }),
            });
            marker.bindTooltip(
              `${record.typePanneauCode !== "N/A" ? record.typePanneauCode : record.entityType} - ${record.title}`,
              { direction: "top", offset: [0, -8] },
            );
            marker.on("click", () => {
              if (measureMode) {
                appendMeasurePoint(displayLatLng);
                return;
              }
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
        vitesseLayer.bindTooltip(getEmpriseTooltipContent(record), {
          sticky: true,
          direction: "top",
        });
        vitesseLayer.bindPopup(buildEmprisePopupContent(record));
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
        depassementLayer.bindTooltip(getEmpriseTooltipContent(record), {
          sticky: true,
          direction: "top",
        });
        depassementLayer.bindPopup(buildEmprisePopupContent(record));
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
  }, [appendMeasurePoint, expandedSiteKey, filteredRecords, hasAdjustedView, layerVisibility, measureMode, panelCategoryStyles, pointOffsets, selectedRecord, siteGroups]);

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

    if (measurePoints.length >= 2) {
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
    if (!map || !selectedRecord) {
      return;
    }

    if (selectedRecord.pointGeometry) {
      const [lon, lat] = selectedRecord.pointGeometry.coordinates;
      const targetLatLng =
        pointOffsets.get(selectedRecord.key) || L.latLng(lat, lon);
      map.panTo(targetLatLng, { animate: true, duration: 0.5 });
      return;
    }

    const selectedGeometry =
      selectedRecord.sourceKind === "vitesse"
        ? selectedRecord.vitesseGeometry
        : selectedRecord.sourceKind === "depassement"
          ? selectedRecord.depassementGeometry
          : null;

    if (selectedGeometry) {
      const bounds = L.geoJSON(selectedGeometry as GeoJSON.GeoJsonObject).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [26, 26] });
      }
    }
  }, [pointOffsets, selectedRecord]);

  const detailItems = useMemo(() => {
    if (!selectedRecord) {
      return [];
    }
    return getRecordDetailItems(selectedRecord);
  }, [selectedRecord]);

  const tableRows = useMemo(() => {
    const records = [...filteredPanelRecords];

    if (tableSort) {
      const column = RECORD_DETAIL_COLUMNS.find((entry) => entry.label === tableSort.label);
      if (column) {
        records.sort((left, right) => {
          const comparison = compareTableValues(column.getValue(left), column.getValue(right));
          return tableSort.direction === "asc" ? comparison : -comparison;
        });
      }
    }

    return records.map((record) => ({
      key: record.key,
      items: getRecordDetailItems(record),
    }));
  }, [filteredPanelRecords, tableSort]);

  const toggleTableSort = (label: string) => {
    setTableSort((current) => {
      if (!current || current.label !== label) {
        return { label, direction: "asc" };
      }
      return { label, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  };

  const toggleFilterSection = (section: FilterSectionKey) => {
    setFilterSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const resetAllFilters = () => {
    setSelectedCatireveCategory("all");
    setSelectedTypePanneau("all");
    setSelectedGammePanneau("all");
    setSelectedPositionPanneau("all");
    setSelectedRoute("all");
    setSelectedCote("all");
    setSelectedPloDebut("all");
    setSelectedArreteNecessaire("all");
    setSelectedTypeEmprise("all");
    setSelectedPdfFilename("all");
    setSelectedPanonceaux("all");
    setSelectedVehicleType("all");
    setSelectedDecisionAttachment("all");
    setExpandedSiteKey(null);
    setHasAdjustedView(false);
  };

  const renderFilterSelect = (
    label: string,
    value: string,
    onChange: (nextValue: string) => void,
    options: string[],
    allLabel: string,
  ) => (
    <label className={styles.filterField}>
      <span className={styles.filterLabel}>{label}</span>
      <select className={styles.searchInput} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );

  const loadingStatus = loading
    ? "Chargement initial de la vue Ceremap3D..."
    : isStreaming
      ? `Chargement progressif en cours: ${loadedRows}/${totalRows ?? loadedRows} lignes.`
      : `Chargement termine: ${loadedRows}/${totalRows ?? loadedRows} lignes.`;
  const loadingCardClassName = `${styles.headerInfoCard} ${
    loading ? styles.headerInfoCardLoading : isStreaming ? styles.headerInfoCardStreaming : styles.headerInfoCardReady
  }`;

  return (
    <div className={`container ${styles.page} ${styles.pageWide}`}>
      <div className={`${styles.workspace} ${!filtersVisible ? styles.workspaceFiltersCollapsed : ""}`}>
        <aside className={`${styles.filterSidebar} ${!filtersVisible ? styles.filterSidebarCollapsed : ""}`}>
          {filtersVisible ? (
            <div className={styles.sidebarHeaderCard}>
              <h1 className={styles.title}>{title}</h1>
              <p className={styles.description}>{description}</p>
              {error ? <p className="muted">{error}</p> : null}
            </div>
          ) : null}

          {filtersVisible ? (
            <div className={styles.sidebarToolbar}>
              <button
                className={styles.sidebarToggle}
                onClick={() => setFiltersVisible((current) => !current)}
                aria-expanded={filtersVisible}
              >
                Masquer les filtres
              </button>
              <button
                className={styles.filterButton}
                onClick={resetAllFilters}
                disabled={activeFilterCount === 0}
              >
                Reinitialiser
              </button>
            </div>
          ) : null}

          {filtersVisible ? (
            <>
              <section className={styles.filterAccordion}>
                <button className={styles.filterAccordionHeader} onClick={() => toggleFilterSection("affichage")}>
                  <span>Affichage carte</span>
                  <span>{filterSections.affichage ? "-" : "+"}</span>
                </button>
                {filterSections.affichage ? (
                  <div className={styles.filterAccordionBody}>
                    <span className={styles.filterLabel}>Fond de carte</span>
                    <div className={styles.layerGrid}>
                      {Object.entries(BASEMAPS).map(([key, config]) => (
                        <button
                          key={key}
                          className={basemap === key ? styles.layerToggleActive : styles.layerToggle}
                          onClick={() => setBasemap(key as BasemapKey)}
                        >
                          {config.label}
                        </button>
                      ))}
                    </div>

                    <span className={styles.filterLabel}>Couches</span>
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
                ) : null}
              </section>

              <div className={styles.sidebarSummaryGrid}>
                <article className={styles.sidebarSummaryCard}>
                  <span className={styles.statValue}>{loading ? "..." : filteredPanelRecords.length}</span>
                  <span className={styles.statLabel}>panneaux visibles</span>
                </article>
                <article className={styles.sidebarSummaryCard}>
                  <span className={styles.statValue}>{loading ? "..." : activeFilterCount}</span>
                  <span className={styles.statLabel}>filtres actifs</span>
                </article>
                <article className={styles.sidebarSummaryCard}>
                  <span className={styles.statValue}>{loading ? "..." : `${vitesseCount}/${depassementCount}`}</span>
                  <span className={styles.statLabel}>vitesse / depassement</span>
                </article>
                <article className={styles.sidebarSummaryCard}>
                  <span className={styles.statValue}>{loading ? "..." : duplicateSiteCount}</span>
                  <span className={styles.statLabel}>sites multi-panneaux</span>
                </article>
              </div>

              <section className={styles.filterAccordion}>
                <button className={styles.filterAccordionHeader} onClick={() => toggleFilterSection("signalisation")}>
                  <span>Signalisation</span>
                  <span>{filterSections.signalisation ? "-" : "+"}</span>
                </button>
                {filterSections.signalisation ? (
                  <div className={styles.filterAccordionBody}>
                    <div className={styles.filterFieldsGrid}>
                      {renderFilterSelect("Categorie de panneau", selectedCatireveCategory, setSelectedCatireveCategory, availableCatireveCategories, "Toutes")}
                      {renderFilterSelect("Type de panneau", selectedTypePanneau, setSelectedTypePanneau, availableTypePanneaux, "Tous")}
                      {renderFilterSelect("Gamme de panneau", selectedGammePanneau, setSelectedGammePanneau, availableGammePanneaux, "Toutes")}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className={styles.filterAccordion}>
                <button className={styles.filterAccordionHeader} onClick={() => toggleFilterSection("implantation")}>
                  <span>Implantation</span>
                  <span>{filterSections.implantation ? "-" : "+"}</span>
                </button>
                {filterSections.implantation ? (
                  <div className={styles.filterAccordionBody}>
                    <div className={styles.filterFieldsGrid}>
                      {renderFilterSelect("Position du panneau", selectedPositionPanneau, setSelectedPositionPanneau, availablePositionPanneaux, "Toutes")}
                      {renderFilterSelect("Route", selectedRoute, setSelectedRoute, availableRoutes, "Toutes")}
                      {renderFilterSelect("Cote circulee", selectedCote, setSelectedCote, availableCotes, "Toutes")}
                      {renderFilterSelect("PLO de debut", selectedPloDebut, setSelectedPloDebut, availablePloDebuts, "Tous")}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className={styles.filterAccordion}>
                <button className={styles.filterAccordionHeader} onClick={() => toggleFilterSection("arretes")}>
                  <span>Arretes et rattachements</span>
                  <span>{filterSections.arretes ? "-" : "+"}</span>
                </button>
                {filterSections.arretes ? (
                  <div className={styles.filterAccordionBody}>
                    <div className={styles.filterFieldsGrid}>
                      {renderFilterSelect("Arrete necessaire", selectedArreteNecessaire, setSelectedArreteNecessaire, availableArretesNecessaires, "Tous")}
                      {renderFilterSelect("Type d'arrete", selectedTypeEmprise, setSelectedTypeEmprise, availableTypeEmprises, "Tous")}
                      {renderFilterSelect("Nom de l'arrete PDF", selectedPdfFilename, setSelectedPdfFilename, availablePdfFilenames, "Tous")}
                      {renderFilterSelect("Panneaux complementaires", selectedPanonceaux, setSelectedPanonceaux, availablePanonceaux, "Tous")}
                      {renderFilterSelect("VL-PL", selectedVehicleType, setSelectedVehicleType, availableVehicleTypes, "Tous")}
                      {renderFilterSelect("Rattachement a un arrete", selectedDecisionAttachment, setSelectedDecisionAttachment, availableDecisionAttachments, "Tous")}
                    </div>
                  </div>
                ) : null}
              </section>

            </>
          ) : null}
        </aside>

        <section className={styles.mapStage}>
          <div className={`${styles.surface} ${styles.mapSurface}`}>
            <div className={`${styles.mapWrap} ${styles.mapWrapDocked}`}>
              {!filtersVisible ? (
                <button className={styles.mapSidebarHandle} onClick={() => setFiltersVisible(true)}>
                  Ouvrir les filtres
                </button>
              ) : null}

              <div id="ceremap3d-map" className={`${styles.map} ${styles.mapLarge}`} />

              {measureVisible ? (
                <div className={styles.mapBadgeSecondary}>
                  <div className={styles.mapPanelHeader}>
                    <span className={styles.mapBadgeLabel}>Mesure</span>
                    <button className={styles.mapPanelToggle} onClick={() => setMeasureVisible(false)}>
                      Masquer
                    </button>
                  </div>
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
                    {measureMode
                      ? "Cliquez sur plusieurs points pour mesurer la distance totale a vol d'oiseau."
                      : "Mode de mesure inactif."}
                  </div>
                  <strong>
                    {measureDistance === null
                      ? "Aucune mesure"
                      : `${formatDistance(measureDistance)}${measurePoints.length > 0 ? ` · ${measurePoints.length} points` : ""}`}
                  </strong>
                </div>
              ) : (
                <button className={styles.mapMeasureHandle} onClick={() => setMeasureVisible(true)}>
                  Ouvrir la mesure
                </button>
              )}

              <div className={styles.floatingLegend}>
                <div className={styles.floatingLegendItem}>
                  <span className={styles.floatingLegendSwatchColor} style={{ background: PANEL_COLOR }} />
                  <div className={styles.floatingLegendContent}>
                    <span className={styles.floatingLegendLabel}>Panneaux</span>
                    <strong>{filteredPanelRecords.length} points visibles</strong>
                  </div>
                </div>
                <div className={styles.floatingLegendItem}>
                  <span className={styles.floatingLegendSwatchWidth} style={{ background: VITESSE_COLOR }} />
                  <div className={styles.floatingLegendContent}>
                    <span className={styles.floatingLegendLabel}>Emprises</span>
                    <strong>{vitesseCount} vitesse, {depassementCount} depassement</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className={`${styles.sidePanel} ${styles.sidePanelDocked}`}>
          <div className={styles.sidePanelHeader}>
            <div className={loadingCardClassName}>
              <span className={styles.filterLabel}>Etat du chargement</span>
              <div className={styles.headerInfoStatusRow}>
                <span
                  className={
                    loading
                      ? styles.headerInfoSpinner
                      : isStreaming
                        ? styles.headerInfoPulse
                        : styles.headerInfoCheck
                  }
                  aria-hidden="true"
                />
                <strong>{loading ? "Initialisation" : isStreaming ? "Streaming" : "Pret"}</strong>
              </div>
              <span className={styles.mutedSmall}>{loadingStatus}</span>
            </div>
            <button className={styles.back} onClick={() => navigate("/dashboardhome")}>
              Retour au dashboard home
            </button>
          </div>

          <h3 className={styles.panelInfoTitle}>{selectedRecord?.sourceKind === "panel" ? "Panneau selectionne" : "Objet selectionne"}</h3>
          {selectedRecord ? (
            <>
              <div className={styles.selectedSummary}>
                <strong>{selectedRecord.typePanneauCode !== "N/A" ? selectedRecord.typePanneauCode : selectedRecord.entityType}</strong>
                <span>{selectedRecord.title}</span>
                <span>{selectedRecord.siteDisplayLabel}</span>
              </div>
              {selectedRecord.sourceKind === "panel" && selectedRecord.imageUrl ? (
                <div className={styles.panelImageCard}>
                  <span className={styles.filterLabel}>Photo du panneau</span>
                  <a href={selectedRecord.imageUrl} target="_blank" rel="noreferrer" className={styles.panelImageLink}>
                    <img
                      src={selectedRecord.imageUrl}
                      alt={selectedRecord.title}
                      className={styles.panelImage}
                      loading="lazy"
                    />
                  </a>
                  {selectedRecord.firstImagePath ? (
                    <span className={styles.mutedSmall}>{selectedRecord.firstImagePath}</span>
                  ) : null}
                </div>
              ) : null}
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
            <p className={styles.mutedSmall}>Aucun objet visible avec les filtres actifs.</p>
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
            {filteredPanelRecords.slice(0, 80).map((record) => (
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
            {filteredPanelRecords.length > 80 ? (
              <p className={styles.mutedSmall}>+ {filteredPanelRecords.length - 80} panneaux supplementaires</p>
            ) : null}
          </div>
        </aside>
      </div>

      <section className={styles.recordsTableSection}>
        <div className={styles.recordsTableHeader}>
          <div>
            <span className={styles.filterLabel}>Table des panneaux</span>
            <h3 className={styles.recordsTableTitle}>Panneaux visibles selon les filtres</h3>
          </div>
          <span className={styles.recordsTableCount}>{filteredPanelRecords.length} lignes</span>
        </div>

        <div className={styles.recordsTableWrap}>
          <table className={styles.recordsTable}>
            <thead>
              <tr>
                {RECORD_DETAIL_COLUMNS.map((column) => (
                  <th key={column.label}>
                    <button
                      type="button"
                      className={styles.recordsTableSortButton}
                      onClick={() => toggleTableSort(column.label)}
                    >
                      <span>{column.label}</span>
                      <span className={styles.recordsTableSortIndicator}>
                        {tableSort?.label === column.label ? (tableSort.direction === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr
                  key={row.key}
                  className={row.key === selectedRecord?.key ? styles.recordsTableRowActive : ""}
                  onClick={() => setSelectedRecordKey(row.key)}
                >
                  {row.items.map((item) => (
                    <td key={`${row.key}-${item.label}`}>{item.value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {tableRows.length === 0 ? <p className={styles.mutedSmall}>Aucun panneau visible avec les filtres actifs.</p> : null}
        </div>
      </section>

      <div className={styles.footerNotes}>
        <p className={styles.footerHint}>
          Couches disponibles: panneaux, emprises vitesse, emprises depassement
          {ploCount > 0 ? `, PLO (${ploCount})` : ". Aucun objet PLO exploitable n'a ete detecte dans cette vue."}
        </p>
        <p className={styles.footerHint}>
          {loadingStatus}
          {!loading && latestUpdate ? ` Derniere mise a jour detectee: ${formatDateValue(latestUpdate)}.` : ""}
        </p>
      </div>
    </div>
  );
}
