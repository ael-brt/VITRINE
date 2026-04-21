const REQUIRED_ENV_VARS = [
  "STELLIO_AUTH_URL",
  "STELLIO_CLIENT_ID",
  "STELLIO_CLIENT_SECRET",
];

const DEFAULT_API_URL =
  "https://data.fabrico.stellio.io/ngsi-ld/v1/entities?type=TronconDeRoute&limit=1000";

function assertNotPlaceholder(name, value) {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.includes("your-oauth-provider.example.com") ||
    normalized.includes("your-client-id") ||
    normalized.includes("your-client-secret")
  ) {
    throw new Error(
      `Environment variable ${name} still contains the example placeholder.\n` +
        "Replace the sample value from .env.example with the real OAuth settings.",
    );
  }
}

export function readConfig() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}.\n` +
        "Create a .env or .env.local file from .env.example before running this script.",
    );
  }

  assertNotPlaceholder("STELLIO_AUTH_URL", process.env.STELLIO_AUTH_URL);
  assertNotPlaceholder("STELLIO_CLIENT_ID", process.env.STELLIO_CLIENT_ID);
  assertNotPlaceholder(
    "STELLIO_CLIENT_SECRET",
    process.env.STELLIO_CLIENT_SECRET,
  );

  return {
    authUrl: process.env.STELLIO_AUTH_URL,
    clientId: process.env.STELLIO_CLIENT_ID,
    clientSecret: process.env.STELLIO_CLIENT_SECRET,
    apiUrl: process.env.STELLIO_API_URL?.trim() || DEFAULT_API_URL,
    apiAccept: process.env.STELLIO_API_ACCEPT?.trim() || "application/json",
    apiLink: process.env.STELLIO_API_LINK?.trim(),
    apiTenant: process.env.STELLIO_API_TENANT?.trim(),
    apiTenantHeader:
      process.env.STELLIO_API_TENANT_HEADER?.trim() || "NGSILD-Tenant",
    scope: process.env.STELLIO_OAUTH_SCOPE?.trim(),
    audience: process.env.STELLIO_OAUTH_AUDIENCE?.trim(),
  };
}

export async function fetchAccessToken(config) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  if (config.scope) {
    body.set("scope", config.scope);
  }

  if (config.audience) {
    body.set("audience", config.audience);
  }

  const response = await fetch(config.authUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};

  if (!response.ok || typeof data.access_token !== "string") {
    throw new Error(
      `Token request failed (${response.status} ${response.statusText}).\n` +
        `${JSON.stringify(data, null, 2)}`,
    );
  }

  return data.access_token;
}

export async function fetchRoadSegments(config, accessToken) {
  const headers = {
    Accept: config.apiAccept,
    Authorization: `Bearer ${accessToken}`,
  };

  if (config.apiLink) {
    headers.Link = config.apiLink;
  }

  if (config.apiTenant) {
    headers[config.apiTenantHeader] = config.apiTenant;
  }

  const entities = [];
  let nextUrl = config.apiUrl;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;

    if (!response.ok) {
      throw new Error(
        `API request failed (${response.status} ${response.statusText}).\n` +
          `${JSON.stringify(data, null, 2)}`,
      );
    }

    if (Array.isArray(data)) {
      entities.push(...data);
    }

    nextUrl = extractNextLink(response.headers.get("link"), config.apiLink);
  }

  return entities;
}

function extractNextLink(headerValue, contextLink) {
  if (!headerValue) {
    return null;
  }

  for (const part of headerValue.split(",")) {
    const segment = part.trim();

    if (!segment.includes('rel="next"') && !segment.includes("rel=next")) {
      continue;
    }

    const match = segment.match(/<([^>]+)>/);

    if (!match) {
      continue;
    }

    const candidate = match[1];

    if (contextLink && candidate === extractPrimaryLinkTarget(contextLink)) {
      continue;
    }

    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      return candidate;
    }

    return new URL(candidate, "https://data.fabrico.stellio.io").toString();
  }

  return null;
}

function extractPrimaryLinkTarget(value) {
  const match = value.match(/<([^>]+)>/);
  return match ? match[1] : value;
}

export function summarizeEntities(payload) {
  if (!Array.isArray(payload)) {
    return {
      count: 0,
      sample: payload,
    };
  }

  const sample = payload[0];

  return {
    count: payload.length,
    sample: sample
      ? {
          id: sample.id,
          type: sample.type,
          keys: Object.keys(sample),
        }
      : null,
  };
}
