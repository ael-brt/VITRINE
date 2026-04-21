import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDashboardBySlug, fetchDashboardData } from "../api/client";
import styles from "./Dashboard.module.css";

const DEFAULT_TITLE = "Dashboard secteurscolaire";
const DEFAULT_DESCRIPTION =
  "Vue metier pour la planification scolaire, les capacites et l'equilibrage territorial des effectifs.";

export function DashboardSecteurScolaire() {
  const navigate = useNavigate();
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [totalEntities, setTotalEntities] = useState<number>(0);
  const [mappedEntities, setMappedEntities] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [dashboard, data] = await Promise.all([
          fetchDashboardBySlug("secteurscolaire"),
          fetchDashboardData("secteurscolaire"),
        ]);

        if (!cancelled) {
          setTitle(dashboard.title || DEFAULT_TITLE);
          setDescription(dashboard.description || DEFAULT_DESCRIPTION);
          setTotalEntities(data.totalEntities);
          setMappedEntities(data.totalEntities - data.stats.unknownGeometryCount);
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger le dashboard depuis l'API.",
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.top}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
          {error ? <p className="muted">{error}</p> : null}
        </div>
        <button className={styles.back} onClick={() => navigate("/welcome")}>Retour a welcome</button>
      </div>

      <div className={styles.stats}>
        <article className={styles.stat}>
          <span className={styles.statValue}>{totalEntities}</span>
          <div className={styles.statLabel}>secteurs analyses</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{mappedEntities}</span>
          <div className={styles.statLabel}>entites exploitables</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>2026</span>
          <div className={styles.statLabel}>scenario de reference</div>
        </article>
      </div>

      <div className={styles.surface}>
        <div className={styles.map}>
          <div className={styles.mapLabel}>
            Carte secteurscolaire
            <br />
            (zone de visualisation du dashboard)
          </div>
        </div>
      </div>
    </div>
  );
}
