import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDashboardBySlug, fetchDashboardData } from "../api/client";
import styles from "./Dashboard.module.css";

const DEFAULT_TITLE = "Dashboard floatingcardata";
const DEFAULT_DESCRIPTION =
  "Vue metier pour les troncons routiers, la mobilite et la densite de circulation.";

export function DashboardFloatingCarData() {
  const navigate = useNavigate();
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [segmentsCount, setSegmentsCount] = useState<number>(0);
  const [lineCount, setLineCount] = useState<number>(0);
  const [pointCount, setPointCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [dashboard, segments] = await Promise.all([
          fetchDashboardBySlug("floatingcardata"),
          fetchDashboardData("floatingcardata"),
        ]);

        if (!cancelled) {
          setTitle(dashboard.title || DEFAULT_TITLE);
          setDescription(dashboard.description || DEFAULT_DESCRIPTION);
          setSegmentsCount(segments.totalEntities);
          setLineCount(segments.stats.lineCount);
          setPointCount(segments.stats.pointCount);
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
          <span className={styles.statValue}>{segmentsCount}</span>
          <div className={styles.statLabel}>entites troncons</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{lineCount}</span>
          <div className={styles.statLabel}>troncons lineaires</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{pointCount}</span>
          <div className={styles.statLabel}>points geolocalises</div>
        </article>
      </div>

      <div className={styles.surface}>
        <div className={styles.map}>
          <div className={styles.mapLabel}>
            Carte floatingcardata
            <br />
            (zone de visualisation du dashboard)
          </div>
        </div>
      </div>
    </div>
  );
}
