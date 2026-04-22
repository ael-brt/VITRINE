import { useEffect, useMemo, useState } from "react";
import {
  fetchContextDefinitions,
  type ContextDefinitionsResult,
  type GroupedDefinition,
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

type GraphNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: "term" | "uri";
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "definition" | "alias";
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

function buildGraphModel(items: GroupedDefinition[]): GraphModel {
  const maxTerms = 220;
  const termToUris = new Map<string, Set<string>>();
  const termEntries: Array<{ term: string; uri: string }> = [];

  for (const item of items) {
    for (const term of item.terms) {
      if (!termToUris.has(term)) {
        termToUris.set(term, new Set<string>());
      }
      const uris = termToUris.get(term);
      if (!uris) {
        continue;
      }
      uris.add(item.uri);
      termEntries.push({ term, uri: item.uri });
    }
  }

  const sortedTerms = Array.from(termToUris.keys()).sort((left, right) =>
    left.localeCompare(right),
  );
  const selectedTerms = sortedTerms.slice(0, maxTerms);
  const selectedTermSet = new Set(selectedTerms);
  const selectedUris = new Set<string>();
  for (const term of selectedTerms) {
    const uris = termToUris.get(term);
    if (!uris) {
      continue;
    }
    for (const uri of uris) {
      selectedUris.add(uri);
    }
  }

  const termList = Array.from(selectedTerms);
  const uriList = Array.from(selectedUris).sort((left, right) => left.localeCompare(right));

  const termSpacing = 34;
  const uriSpacing = 34;
  const basePadding = 42;
  const contentRows = Math.max(termList.length, uriList.length, 1);
  const height = basePadding * 2 + contentRows * Math.max(termSpacing, uriSpacing);
  const width = 1480;
  const termX = 260;
  const uriX = 1210;

  const nodes: GraphNode[] = [];
  const nodeIndex = new Map<string, GraphNode>();

  for (let index = 0; index < termList.length; index += 1) {
    const term = termList[index];
    const node: GraphNode = {
      id: `term:${term}`,
      label: term,
      kind: "term",
      x: termX,
      y: basePadding + (index + 1) * termSpacing,
    };
    nodes.push(node);
    nodeIndex.set(node.id, node);
  }

  for (let index = 0; index < uriList.length; index += 1) {
    const uri = uriList[index];
    const node: GraphNode = {
      id: `uri:${uri}`,
      label: ellipsis(uri, 68),
      kind: "uri",
      x: uriX,
      y: basePadding + (index + 1) * uriSpacing,
    };
    nodes.push(node);
    nodeIndex.set(node.id, node);
  }

  const edges: GraphEdge[] = [];
  for (const entry of termEntries) {
    if (!selectedTermSet.has(entry.term) || !selectedUris.has(entry.uri)) {
      continue;
    }
    edges.push({
      id: `def:${entry.term}->${entry.uri}`,
      source: `term:${entry.term}`,
      target: `uri:${entry.uri}`,
      kind: "definition",
    });
  }

  for (const item of items) {
    const terms = item.terms.filter((term) => selectedTermSet.has(term));
    if (terms.length < 2) {
      continue;
    }
    for (let index = 0; index < terms.length - 1; index += 1) {
      const source = terms[index];
      const target = terms[index + 1];
      edges.push({
        id: `alias:${item.uri}:${source}:${target}`,
        source: `term:${source}`,
        target: `term:${target}`,
        kind: "alias",
      });
    }
  }

  return {
    nodes,
    edges,
    width,
    height,
    truncated: sortedTerms.length > maxTerms,
  };
}

type OntologyGraphProps = {
  items: GroupedDefinition[];
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
        Noeuds a gauche: termes. Noeuds a droite: URI de definitions CEREMA. Traits verts:
        relation terme → URI. Traits pointilles: alias entre termes d'une meme URI.
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
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className={edge.kind === "definition" ? styles.edgeDefinition : styles.edgeAlias}
              />
            );
          })}

          {model.nodes.map((node) => (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <circle className={node.kind === "term" ? styles.nodeTerm : styles.nodeUri} r="5.5" />
              <text
                className={styles.nodeLabel}
                x={node.kind === "term" ? -10 : 10}
                y="4"
                textAnchor={node.kind === "term" ? "end" : "start"}
              >
                {node.label}
              </text>
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
};

function DefinitionCard({ item, external }: DefinitionCardProps) {
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
          <li key={term}>{term}</li>
        ))}
      </ul>

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
  const [payload, setPayload] = useState<ContextDefinitionsResult | null>(null);
  const [tab, setTab] = useState<SubTab>("definitions");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const definitions = await fetchContextDefinitions();
        if (!cancelled) {
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

  const filteredInternal = useMemo(() => {
    return filterDefinitions(payload?.internal ?? [], query);
  }, [payload?.internal, query]);

  const filteredExternal = useMemo(() => {
    return filterDefinitions(payload?.external ?? [], query);
  }, [payload?.external, query]);

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
                      <DefinitionCard key={item.uri} item={item} external={false} />
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
                      <DefinitionCard key={item.uri} item={item} external />
                    ))}
                  </div>
                </section>
              </>
            )}

            {tab === "graph" && <OntologyGraph items={filteredInternal} />}
          </>
        )}
      </div>
    </section>
  );
}
