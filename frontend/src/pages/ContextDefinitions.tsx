import { useEffect, useMemo, useState } from "react";
import {
  fetchContextDefinitions,
  type ContextDefinitionsFilters,
  type ContextDefinitionsResult,
  type GroupedDefinition,
  type InternalPropertyLink,
} from "../api/contextDefinitions";
import styles from "./ContextDefinitions.module.css";

type SubTab = "definitions" | "graph";

function filterDefinitions(items: GroupedDefinition[], query: string): GroupedDefinition[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => {
    if (item.uri.toLowerCase().includes(normalizedQuery)) {
      return true;
    }
    if (item.terms.some((term) => term.toLowerCase().includes(normalizedQuery))) {
      return true;
    }
    return item.sourceFiles.some((file) => file.toLowerCase().includes(normalizedQuery));
  });
}

function filterPropertyLinks(items: InternalPropertyLink[], query: string): InternalPropertyLink[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => {
    return (
      item.term.toLowerCase().includes(normalizedQuery) ||
      item.uri.toLowerCase().includes(normalizedQuery) ||
      item.entityTerm.toLowerCase().includes(normalizedQuery) ||
      item.entityUri.toLowerCase().includes(normalizedQuery) ||
      item.sourceFile.toLowerCase().includes(normalizedQuery)
    );
  });
}

type GraphNode = {
  id: string;
  label: string;
  subtitle?: string;
  x: number;
  y: number;
  isInternalProperty?: boolean;
  kind: "property" | "domain" | "entity" | "file";
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: "definie_dans" | "domaine" | "contenue";
};

type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  truncated: boolean;
};

function ellipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}

function buildGraphModel(items: InternalPropertyLink[]): GraphModel {
  const maxProperties = 180;
  const selected = items.slice(0, maxProperties);
  const truncated = items.length > maxProperties;

  const fileIds = new Map<string, GraphNode>();
  const entityIds = new Map<string, GraphNode>();
  const domainIds = new Map<string, GraphNode>();
  const propertyIds = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const files = Array.from(new Set(selected.map((item) => item.sourceFile))).sort((a, b) =>
    a.localeCompare(b),
  );

  const entities = Array.from(
    new Set(selected.map((item) => `${item.sourceFile}||${item.entityTerm}||${item.entityUri}`)),
  ).sort((a, b) => a.localeCompare(b));

  const fileX = 130;
  const entityX = 560;
  const domainX = 970;
  const propertyX = 1410;
  const fileSpacing = 54;
  const entitySpacing = 38;
  const propertySpacing = 34;
  const basePadding = 36;
  const rows = Math.max(files.length + 1, entities.length + 1, selected.length + 1, 8);
  const height = basePadding * 2 + rows * 40;
  const width = 1600;

  files.forEach((file, index) => {
    fileIds.set(file, {
      id: `file:${file}`,
      label: ellipsis(file, 40),
      x: fileX,
      y: basePadding + (index + 1) * fileSpacing,
      kind: "file",
    });
  });

  entities.forEach((entityKey, index) => {
    const [sourceFile, entityTerm, entityUri] = entityKey.split("||");
    const node: GraphNode = {
      id: `entity:${entityKey}`,
      label: entityTerm,
      subtitle: ellipsis(entityUri, 52),
      x: entityX,
      y: basePadding + (index + 1) * entitySpacing,
      kind: "entity",
    };
    entityIds.set(entityKey, node);

    const fileNode = fileIds.get(sourceFile);
    if (fileNode) {
      edges.push({
        id: `contenue:${entityKey}->${sourceFile}`,
        source: node.id,
        target: fileNode.id,
        relation: "contenue",
      });
    }
  });

  const domainList = Array.from(
    new Set(selected.map((item) => item.definitionSource || "unknown")),
  ).sort((a, b) => a.localeCompare(b));

  domainList.forEach((domain, index) => {
    domainIds.set(domain, {
      id: `domain:${domain}`,
      label: domain,
      x: domainX,
      y: basePadding + (index + 1) * 56,
      kind: "domain",
    });
  });

  selected.forEach((item, index) => {
    const propertyId = `property:${item.sourceFile}||${item.term}||${item.uri}`;
    const node: GraphNode = {
      id: propertyId,
      label: item.term,
      subtitle: ellipsis(item.uri, 56),
      x: propertyX,
      y: basePadding + (index + 1) * propertySpacing,
      kind: "property",
      isInternalProperty: item.isInternal,
    };
    propertyIds.set(propertyId, node);

    const domainKey = item.definitionSource || "unknown";
    const domainNode = domainIds.get(domainKey);
    if (domainNode) {
      edges.push({
        id: `definie_dans:${propertyId}->${domainNode.id}`,
        source: propertyId,
        target: domainNode.id,
        relation: "definie_dans",
      });
    }

    const entityKey = `${item.sourceFile}||${item.entityTerm}||${item.entityUri}`;
    const entityNode = entityIds.get(entityKey);
    if (entityNode && domainNode) {
      edges.push({
        id: `domaine:${domainNode.id}->${entityNode.id}`,
        source: domainNode.id,
        target: entityNode.id,
        relation: "domaine",
      });
    }
  });

  return {
    nodes: [...fileIds.values(), ...entityIds.values(), ...domainIds.values(), ...propertyIds.values()],
    edges,
    width,
    height,
    truncated,
  };
}

type OntologyGraphProps = {
  items: InternalPropertyLink[];
};

function OntologyGraph({ items }: OntologyGraphProps) {
  const model = useMemo(() => buildGraphModel(items), [items]);
  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of model.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [model.nodes]);

  if (model.nodes.length === 0) {
    return <div className={styles.status}>Aucun noeud a afficher pour ce filtre.</div>;
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Modele graphe de l'ontologie</h2>
      <p className={styles.sectionSubtitle}>
        Les URI sont des attributs de noeuds de proprietes. Un noeud intermediaire indique ou la
        propriete est definie (<code>cerema</code>, <code>schema.org</code>, etc). Relations:
        <code>definie_dans</code> (propriete → domaine), <code>domaine</code> (domaine → entite),
        puis <code>contenue</code> (entite → fichier).
        Les proprietes internes CEREMA et les references externes sont toutes deux affichees.
      </p>

      {model.truncated && (
        <div className={styles.status}>
          Affichage limite aux 220 premiers termes pour conserver un graphe lisible. Affine la
          recherche pour explorer le reste.
        </div>
      )}

      <div className={styles.graphFrame}>
        <svg viewBox={`0 0 ${model.width} ${model.height}`} className={styles.graphSvg}>
          {model.edges.map((edge) => {
            const source = nodesById.get(edge.source);
            const target = nodesById.get(edge.target);
            if (!source || !target) {
              return null;
            }
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            return (
              <g key={edge.id}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  className={
                    edge.relation === "contenue" ? styles.edgeAlias : styles.edgeDefinition
                  }
                />
                <text x={midX} y={midY - 2} className={styles.edgeLabel} textAnchor="middle">
                  {edge.relation}
                </text>
              </g>
            );
          })}

          {model.nodes.map((node) => (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <circle
                className={
                  node.kind === "property"
                    ? node.isInternalProperty
                      ? styles.nodeTerm
                      : styles.nodeTermExternal
                    : node.kind === "domain"
                      ? styles.nodeDomain
                    : node.kind === "entity"
                      ? styles.nodeUri
                      : styles.nodeFile
                }
                r="6"
              />
              <text
                className={styles.nodeLabel}
                x={node.kind === "property" ? -10 : 10}
                y="4"
                textAnchor={node.kind === "property" ? "end" : "start"}
              >
                {node.label}
              </text>
              {node.subtitle && (
                <text
                  className={styles.nodeSubLabel}
                  x={node.kind === "property" ? -10 : 10}
                  y="18"
                  textAnchor={node.kind === "property" ? "end" : "start"}
                >
                  {node.subtitle}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

type DefinitionCardProps = {
  item: GroupedDefinition;
  external: boolean;
  definitionSourcesByTerm: Map<string, string>;
};

function DefinitionCard({ item, external, definitionSourcesByTerm }: DefinitionCardProps) {
  return (
    <article className={styles.card}>
      <p className={styles.uri}>
        {external ? (
          <a
            href={item.uri}
            target="_blank"
            rel="noreferrer"
            className={styles.uriLink}
            title="Ouvrir la définition externe"
          >
            {item.uri}
          </a>
        ) : (
          item.uri
        )}
      </p>

      <p className={styles.blockTitle}>Proprietes</p>
      <ul className={styles.list}>
        {item.terms.map((term) => (
          <li key={term}>
            {term}
            {definitionSourcesByTerm.get(`${item.uri}||${term}`) && (
              <span className={styles.termMeta}>
                {" "}
                ({definitionSourcesByTerm.get(`${item.uri}||${term}`)})
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className={styles.blockTitle}>Definition</p>
      <div className={styles.definitionPlaceholder} />

      <p className={styles.blockTitle}>Fichiers contextes</p>
      <ul className={styles.list}>
        {item.sourceFiles.map((sourceFile) => (
          <li key={sourceFile}>{sourceFile}</li>
        ))}
      </ul>
    </article>
  );
}

export function ContextDefinitions() {
  const [catalogPayload, setCatalogPayload] = useState<ContextDefinitionsResult | null>(null);
  const [payload, setPayload] = useState<ContextDefinitionsResult | null>(null);
  const [tab, setTab] = useState<SubTab>("definitions");
  const [selectedDashboard, setSelectedDashboard] = useState("");
  const [selectedEntityType, setSelectedEntityType] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const definitions = await fetchContextDefinitions();
        if (!cancelled) {
          setCatalogPayload(definitions);
          setPayload(definitions);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          const detail =
            cause instanceof Error ? cause.message : "Erreur inconnue pendant le chargement.";
          setError(detail);
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

  useEffect(() => {
    let cancelled = false;
    if (!catalogPayload) {
      return () => {
        cancelled = true;
      };
    }

    async function reloadWithFilters() {
      setLoading(true);
      try {
        const filters: ContextDefinitionsFilters = {
          dashboard: selectedDashboard || null,
          entityType: selectedEntityType || null,
        };
        const filtered = await fetchContextDefinitions(filters);
        if (!cancelled) {
          setPayload(filtered);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          const detail =
            cause instanceof Error ? cause.message : "Erreur inconnue pendant le chargement.";
          setError(detail);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void reloadWithFilters();
    return () => {
      cancelled = true;
    };
  }, [catalogPayload, selectedDashboard, selectedEntityType]);

  const dashboardOptions = useMemo(() => {
    const links = catalogPayload?.propertyLinks ?? [];
    return Array.from(
      new Set(links.map((item) => item.dashboardSlug).filter((item) => !!item)),
    ).sort((left, right) => left.localeCompare(right));
  }, [catalogPayload?.propertyLinks]);

  const entityTypeOptions = useMemo(() => {
    const links = catalogPayload?.propertyLinks ?? [];
    return Array.from(
      new Set(
        links
          .filter((item) => !selectedDashboard || item.dashboardSlug === selectedDashboard)
          .map((item) => item.entityType)
          .filter((item) => !!item),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }, [catalogPayload?.propertyLinks, selectedDashboard]);

  useEffect(() => {
    if (!selectedEntityType) {
      return;
    }
    if (!entityTypeOptions.includes(selectedEntityType)) {
      setSelectedEntityType("");
    }
  }, [entityTypeOptions, selectedEntityType]);

  const filteredInternal = useMemo(() => {
    return filterDefinitions(payload?.internal ?? [], query);
  }, [payload?.internal, query]);

  const filteredExternal = useMemo(() => {
    return filterDefinitions(payload?.external ?? [], query);
  }, [payload?.external, query]);
  const filteredPropertyLinks = useMemo(() => {
    const links =
      payload?.propertyLinks ??
      (payload?.internalProperties ?? []).map((item) => ({ ...item, isInternal: true }));
    return filterPropertyLinks(links, query);
  }, [payload?.propertyLinks, payload?.internalProperties, query]);

  const definitionSourcesByTerm = useMemo(() => {
    const byTerm = new Map<string, Set<string>>();
    for (const item of filteredPropertyLinks) {
      if (!item.uri || !item.term) {
        continue;
      }
      const key = `${item.uri}||${item.term}`;
      if (!byTerm.has(key)) {
        byTerm.set(key, new Set<string>());
      }
      byTerm.get(key)?.add(item.definitionSource || "unknown");
    }
    const flattened = new Map<string, string>();
    for (const [key, values] of byTerm.entries()) {
      flattened.set(key, Array.from(values).sort((left, right) => left.localeCompare(right)).join(", "));
    }
    return flattened;
  }, [filteredPropertyLinks]);

  return (
    <section className={styles.page}>
      <div className="container">
        <header className={styles.hero}>
          <span className="eyebrow">Contextualisation NGSI-LD</span>
          <h1 className={styles.title}>Definitions des contextes CEREMA</h1>
          <p className={styles.description}>
            Cette page consolide tous les fichiers <code>*-context.jsonld</code> du depot
            <code> CEREMA/ngsild-api-data-models</code>.
            Les proprietes liees a des URI externes sont presentees comme liens.
            Les URI CEREMA sont documentees ici avec leurs proprietes associees.
          </p>
          {payload && (
            <div className={styles.stats}>
              <span className="pill">{payload.files.length} fichiers contextes</span>
              <span className="pill">{payload.internal.length} URI CEREMA</span>
              <span className="pill">{payload.external.length} URI externes</span>
              {payload.skippedFiles.length > 0 && (
                <span className="pill">{payload.skippedFiles.length} fichier(s) ignores</span>
              )}
            </div>
          )}
        </header>

        <div className={styles.controls}>
          <div className={styles.filtersRow}>
            <label className={styles.filterLabel}>
              Dashboard
              <select
                className={styles.filterSelect}
                value={selectedDashboard}
                onChange={(event) => setSelectedDashboard(event.target.value)}
              >
                <option value="">Tous</option>
                {dashboardOptions.map((dashboard) => (
                  <option key={dashboard} value={dashboard}>
                    {dashboard}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterLabel}>
              Entite
              <select
                className={styles.filterSelect}
                value={selectedEntityType}
                onChange={(event) => setSelectedEntityType(event.target.value)}
              >
                <option value="">Toutes</option>
                {entityTypeOptions.map((entityType) => (
                  <option key={entityType} value={entityType}>
                    {entityType}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.subTabs} role="tablist" aria-label="Sous-onglets contextes">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "definitions"}
              className={`${styles.subTabButton} ${
                tab === "definitions" ? styles.subTabButtonActive : ""
              }`}
              onClick={() => setTab("definitions")}
            >
              Definitions
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "graph"}
              className={`${styles.subTabButton} ${
                tab === "graph" ? styles.subTabButtonActive : ""
              }`}
              onClick={() => setTab("graph")}
            >
              Graphe ontology
            </button>
          </div>

          <input
            type="search"
            className={styles.search}
            placeholder="Rechercher une propriete, une URI ou un fichier contexte..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {loading && <div className={styles.status}>Chargement des contextes en cours...</div>}

        {!loading && error && <div className={`${styles.status} ${styles.error}`}>{error}</div>}

        {!loading && !error && payload && (
          <>
            {payload.skippedFiles.length > 0 && (
              <div className={`${styles.status} ${styles.error}`}>
                {payload.skippedFiles.length} fichier(s) contexte n'ont pas pu etre parses.
                L'onglet reste utilisable avec les autres fichiers valides.
              </div>
            )}
            {tab === "definitions" && (
              <>
                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>Definitions internes CEREMA</h2>
                  <p className={styles.sectionSubtitle}>
                    URI contenant <code>semantics.cerema.fr</code>. Les definitions sont detaillees
                    directement dans cette page.
                  </p>
                  <div className={styles.grid}>
                    {filteredInternal.map((item) => (
                      <DefinitionCard
                        key={item.uri}
                        item={item}
                        external={false}
                        definitionSourcesByTerm={definitionSourcesByTerm}
                      />
                    ))}
                  </div>
                </section>

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>References externes</h2>
                  <p className={styles.sectionSubtitle}>
                    URI hors CEREMA. Elles ne sont pas redefinies ici et redirigent vers leur
                    source.
                  </p>
                  <div className={styles.grid}>
                    {filteredExternal.map((item) => (
                      <DefinitionCard
                        key={item.uri}
                        item={item}
                        external
                        definitionSourcesByTerm={definitionSourcesByTerm}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}

            {tab === "graph" && <OntologyGraph items={filteredPropertyLinks} />}
          </>
        )}
      </div>
    </section>
  );
}
