import { useEffect, useMemo, useState } from "react";
import {
  fetchContextDefinitions,
  type ContextDefinitionsResult,
  type GroupedDefinition,
} from "../api/contextDefinitions";
import styles from "./ContextDefinitions.module.css";

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
            </div>
          )}
        </header>

        <div className={styles.controls}>
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
                URI hors CEREMA. Elles ne sont pas redefinies ici et redirigent vers leur source.
              </p>
              <div className={styles.grid}>
                {filteredExternal.map((item) => (
                  <DefinitionCard key={item.uri} item={item} external />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}

