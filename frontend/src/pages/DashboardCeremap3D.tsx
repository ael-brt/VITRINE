import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDashboardBySlug, fetchDashboardKpis, fetchDashboardMap } from "../api/client";
import styles from "./Dashboard.module.css";

const DEFAULT_TITLE = "Dashboard ceremap3d";
const DEFAULT_DESCRIPTION =
  "Vue metier pour le suivi des panneaux de signalisation et des indicateurs Ceremap3D.";

export function DashboardCeremap3D() {
  const navigate = useNavigate();
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [totalPanneaux, setTotalPanneaux] = useState(0);
  const [mappedPanneaux, setMappedPanneaux] = useState(0);
  const [withJoinKey, setWithJoinKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [dashboard, kpis, map] = await Promise.all([
          fetchDashboardBySlug("ceremap3d"),
          fetchDashboardKpis("ceremap3d", { type: "Panneau" }),
          fetchDashboardMap("ceremap3d", { type: "Panneau", page: 1, pageSize: 500 }),
        ]);

        const mappable = map.items.filter((item) => item.geometry !== null).length;

        if (!cancelled) {
          setTitle(dashboard.title || DEFAULT_TITLE);
          setDescription(dashboard.description || DEFAULT_DESCRIPTION);
          setTotalPanneaux(kpis.totalEntities);
          setMappedPanneaux(mappable);
          setWithJoinKey(kpis.withJoinKey);
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger le dashboard ceremap3d depuis l'API.",
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
        <button className={styles.back} onClick={() => navigate("/dashboardhome")}>
          Retour au dashboard home
        </button>
      </div>

      <div className={styles.stats}>
        <article className={styles.stat}>
          <span className={styles.statValue}>{totalPanneaux}</span>
          <div className={styles.statLabel}>panneaux total</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{mappedPanneaux}</span>
          <div className={styles.statLabel}>panneaux avec geometrie</div>
        </article>
        <article className={styles.stat}>
          <span className={styles.statValue}>{withJoinKey}</span>
          <div className={styles.statLabel}>panneaux avec cle de jointure</div>
        </article>
      </div>

      <div className={styles.surface}>
        <div className={styles.map}>
          <div className={styles.mapLabel}>
            Carte Ceremap3D - Panneau
            <br />
            (zone de visualisation du dashboard)
          </div>
        </div>
      </div>
    </div>
  );
}
