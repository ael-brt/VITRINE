import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchDashboards } from "../api/client";
import { logout } from "../auth";
import styles from "./Welcome.module.css";

type DashboardCard = {
  id: string;
  title: string;
  description: string;
  route: string;
};

const fallbackDashboards: DashboardCard[] = [
  {
    id: "floatingcardata",
    title: "floatingcardata",
    description:
      "Observation des flux routiers et des troncons geolocalises issus des donnees floating car.",
    route: "/dashboards/floatingcardata",
  },
  {
    id: "secteurscolaire",
    title: "secteurscolaire",
    description:
      "Pilotage territorial des secteurs scolaires avec visualisation cartographique et indicateurs.",
    route: "/dashboards/secteurscolaire",
  },
];

function toRoute(slug: string) {
  return `/dashboards/${slug}`;
}

export function Welcome() {
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState<DashboardCard[]>(fallbackDashboards);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await fetchDashboards();

        if (!cancelled && result.length > 0) {
          setDashboards(
            result.map((item) => ({
              id: item.slug,
              title: item.title || item.slug,
              description: item.description || "Tableau de bord metier",
              route: toRoute(item.slug),
            })),
          );
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger les dashboards depuis l'API.",
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/connexion", { replace: true });
  }

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard Home</h1>
          <p className={styles.subtitle}>
            Choisissez une carte pour ouvrir le tableau de bord associe. Les
            pages sont reservees a l'espace connecte.
          </p>
          {error ? <p className="muted">{error}</p> : null}
        </div>
        <button className={styles.logout} onClick={handleLogout} type="button">
          Deconnexion
        </button>
      </div>

      <div className={styles.grid}>
        {dashboards.map((dashboard) => (
          <Link key={dashboard.id} to={dashboard.route} className={styles.card}>
            <div className={styles.visual} />
            <div className={styles.content}>
              <span className={styles.chip}>Carte dashboard</span>
              <h2 className={styles.cardTitle}>{dashboard.title}</h2>
              <p className={styles.description}>{dashboard.description}</p>
              <span className={styles.cta}>Ouvrir le tableau de bord -&gt;</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
