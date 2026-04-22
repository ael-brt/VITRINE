const REPO_OWNER = "CEREMA";
const REPO_NAME = "ngsild-api-data-models";
const REPO_BRANCH = "main";
const TREE_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${REPO_BRANCH}?recursive=1`;
const RAW_BASE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/`;
const CACHE_KEY = "vitrine.context-definitions.v1";

type JsonLdContextValue = string | { "@id"?: string } | null;

type JsonLdDocument = {
  "@context"?: unknown;
};

type TreeEntry = {
  path: string;
  type: string;
};

export type DefinitionItem = {
  term: string;
  uri: string;
  sourceFile: string;
};

export type GroupedDefinition = {
  uri: string;
  terms: string[];
  sourceFiles: string[];
};

export type ContextDefinitionsResult = {
  files: string[];
  internal: GroupedDefinition[];
  external: GroupedDefinition[];
  skippedFiles: Array<{ file: string; reason: string }>;
};

function readSessionCache(): ContextDefinitionsResult | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(CACHE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ContextDefinitionsResult>;
    if (!Array.isArray(parsed.files) || !Array.isArray(parsed.internal) || !Array.isArray(parsed.external)) {
      return null;
    }
    return {
      files: parsed.files,
      internal: parsed.internal as GroupedDefinition[],
      external: parsed.external as GroupedDefinition[],
      skippedFiles: Array.isArray(parsed.skippedFiles) ? parsed.skippedFiles : [],
    };
  } catch {
    return null;
  }
}

function writeSessionCache(payload: ContextDefinitionsResult) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

function sanitizeJsonLikeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/,\s*([}\]])/g, "$1");
}

function isAbsoluteUri(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^urn:/i.test(value);
}

function isLikelyPrefix(value: string): boolean {
  if (!isAbsoluteUri(value)) {
    return false;
  }
  return value.endsWith("/") || value.endsWith("#");
}

function resolveCompactIri(value: string, prefixes: Map<string, string>): string {
  if (isAbsoluteUri(value)) {
    return value;
  }
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return "";
  }

  const prefix = value.slice(0, separatorIndex);
  const suffix = value.slice(separatorIndex + 1);
  const base = prefixes.get(prefix);
  if (!base) {
    return "";
  }
  return `${base}${suffix}`;
}

function flattenContext(rawContext: unknown): Record<string, JsonLdContextValue>[] {
  if (!rawContext) {
    return [];
  }
  if (Array.isArray(rawContext)) {
    return rawContext.filter((item): item is Record<string, JsonLdContextValue> => {
      return item !== null && typeof item === "object" && !Array.isArray(item);
    });
  }
  if (typeof rawContext === "object") {
    return [rawContext as Record<string, JsonLdContextValue>];
  }
  return [];
}

function classifyAsInternal(uri: string): boolean {
  return /semantics\.cerema\.fr/i.test(uri);
}

function groupDefinitions(items: DefinitionItem[]): GroupedDefinition[] {
  const grouped = new Map<string, { terms: Set<string>; sourceFiles: Set<string> }>();
  for (const item of items) {
    if (!grouped.has(item.uri)) {
      grouped.set(item.uri, {
        terms: new Set<string>(),
        sourceFiles: new Set<string>(),
      });
    }
    const bucket = grouped.get(item.uri);
    if (!bucket) {
      continue;
    }
    bucket.terms.add(item.term);
    bucket.sourceFiles.add(item.sourceFile);
  }

  return Array.from(grouped.entries())
    .map(([uri, value]) => ({
      uri,
      terms: Array.from(value.terms).sort((left, right) => left.localeCompare(right)),
      sourceFiles: Array.from(value.sourceFiles).sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => left.uri.localeCompare(right.uri));
}

async function fetchTreeEntries(): Promise<TreeEntry[]> {
  const response = await fetch(TREE_API_URL);
  if (!response.ok) {
    throw new Error(`Impossible de lister les fichiers contextes (${response.status}).`);
  }
  const payload = (await response.json()) as { tree?: TreeEntry[] };
  return Array.isArray(payload.tree) ? payload.tree : [];
}

async function fetchContextFile(path: string): Promise<JsonLdDocument> {
  const response = await fetch(`${RAW_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Impossible de charger ${path} (${response.status}).`);
  }
  const raw = await response.text();
  try {
    return JSON.parse(raw) as JsonLdDocument;
  } catch (error) {
    const sanitized = sanitizeJsonLikeText(raw);
    try {
      return JSON.parse(sanitized) as JsonLdDocument;
    } catch {
      const detail = error instanceof Error ? error.message : "JSON parse error";
      throw new Error(`JSON invalide dans ${path}: ${detail}`);
    }
  }
}

function extractDefinitions(document: JsonLdDocument, sourceFile: string): DefinitionItem[] {
  const contexts = flattenContext(document["@context"]);
  const prefixes = new Map<string, string>();
  const items: DefinitionItem[] = [];

  for (const context of contexts) {
    for (const [key, rawValue] of Object.entries(context)) {
      if (key.startsWith("@")) {
        continue;
      }
      if (typeof rawValue === "string" && isLikelyPrefix(rawValue)) {
        prefixes.set(key, rawValue);
      }
    }
  }

  for (const context of contexts) {
    for (const [key, rawValue] of Object.entries(context)) {
      if (key.startsWith("@")) {
        continue;
      }

      let candidate = "";
      if (typeof rawValue === "string") {
        candidate = resolveCompactIri(rawValue, prefixes);
      } else if (rawValue && typeof rawValue === "object" && "@id" in rawValue) {
        const value = rawValue["@id"];
        if (typeof value === "string") {
          candidate = resolveCompactIri(value, prefixes);
        }
      }

      if (!candidate || !isAbsoluteUri(candidate)) {
        continue;
      }
      items.push({
        term: key,
        uri: candidate,
        sourceFile,
      });
    }
  }

  return items;
}

export async function fetchContextDefinitions(): Promise<ContextDefinitionsResult> {
  const cached = readSessionCache();
  if (cached) {
    return cached;
  }

  const entries = await fetchTreeEntries();
  const contextFiles = entries
    .filter((entry) => entry.type === "blob" && entry.path.endsWith("-context.jsonld"))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));

  const allDefinitions: DefinitionItem[] = [];
  const skippedFiles: Array<{ file: string; reason: string }> = [];
  for (const file of contextFiles) {
    try {
      const document = await fetchContextFile(file);
      allDefinitions.push(...extractDefinitions(document, file));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Erreur de lecture";
      skippedFiles.push({ file, reason });
    }
  }

  const internalItems = allDefinitions.filter((item) => classifyAsInternal(item.uri));
  const externalItems = allDefinitions.filter((item) => !classifyAsInternal(item.uri));

  const result: ContextDefinitionsResult = {
    files: contextFiles,
    internal: groupDefinitions(internalItems),
    external: groupDefinitions(externalItems),
    skippedFiles,
  };

  writeSessionCache(result);
  return result;
}
