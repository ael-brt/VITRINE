import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fetchAccessToken,
  fetchRoadSegments,
  readConfig,
} from "./lib/stellio-client.mjs";

const OUTPUT_FILE = resolve("public/data/troncons.geojson");

function extractGeometry(entity) {
  const localisation = entity.localisation;

  if (!localisation || localisation.type !== "GeoProperty") {
    return null;
  }

  return localisation.value ?? null;
}

function extractDisplayName(entity) {
  const candidates = [
    entity.nom?.value,
    entity.libelle?.value,
    entity.name?.value,
    entity.id,
  ];

  return candidates.find((candidate) => typeof candidate === "string") ?? entity.id;
}

function toFeature(entity) {
  const geometry = extractGeometry(entity);

  if (!geometry || typeof geometry.type !== "string") {
    return null;
  }

  return {
    type: "Feature",
    id: entity.id,
    properties: {
      id: entity.id,
      type: entity.type,
      label: extractDisplayName(entity),
    },
    geometry,
  };
}

function toFeatureCollection(entities, sourceUrl) {
  const features = entities.map(toFeature).filter(Boolean);

  return {
    type: "FeatureCollection",
    generatedAt: new Date().toISOString(),
    sourceUrl,
    featureCount: features.length,
    totalEntities: entities.length,
    features,
  };
}

async function main() {
  const config = readConfig();

  console.log(`Requesting token from ${config.authUrl}`);
  const accessToken = await fetchAccessToken(config);
  console.log("Token acquired.");

  console.log(`Fetching entities from ${config.apiUrl}`);
  const entities = await fetchRoadSegments(config, accessToken);

  if (!Array.isArray(entities)) {
    throw new Error("Expected an array of NGSI-LD entities.");
  }

  const geojson = toFeatureCollection(entities, config.apiUrl);
  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(geojson, null, 2)}\n`);

  console.log(
    `Wrote ${geojson.featureCount} geometries from ${geojson.totalEntities} entities to ${OUTPUT_FILE}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
