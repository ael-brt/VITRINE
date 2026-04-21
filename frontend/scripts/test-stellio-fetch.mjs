import {
  fetchAccessToken,
  fetchRoadSegments,
  readConfig,
  summarizeEntities,
} from "./lib/stellio-client.mjs";

async function main() {
  const config = readConfig();

  console.log(`Requesting token from ${config.authUrl}`);
  const accessToken = await fetchAccessToken(config);
  console.log("Token acquired.");

  console.log(`Fetching entities from ${config.apiUrl}`);
  if (config.apiTenant) {
    console.log(`Using tenant header ${config.apiTenantHeader}.`);
  }
  if (config.apiLink) {
    console.log("Using Link header.");
  }
  const payload = await fetchRoadSegments(config, accessToken);
  const summary = summarizeEntities(payload);

  console.log("Fetch succeeded.");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  if (error instanceof TypeError && error.message === "fetch failed") {
    console.error(
      "Network request failed before the OAuth server returned a response.\n" +
        "Check STELLIO_AUTH_URL first. If it still points to the example host, replace it with the real token endpoint.",
    );
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
