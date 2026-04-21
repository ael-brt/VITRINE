import { useEffect, useState } from "react";
import { fetchProjects } from "../api/client";
import { ProjectGrid } from "../components/ProjectGrid/ProjectGrid";
import { SectionTitle } from "../components/SectionTitle/SectionTitle";
import { projects as fallbackProjects } from "../data/projects";
import type { Project } from "../types/domain";

export function Projects() {
  const [items, setItems] = useState<Project[]>(fallbackProjects);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await fetchProjects();

        if (!cancelled) {
          if (result.length > 0) {
            setItems(result);
          }
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger les projets depuis l'API.",
          );
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

  return (
    <div className="container" style={{ padding: "72px 0" }}>
      <SectionTitle
        eyebrow="Realisations"
        title="Decouvrir les projets"
        description="Toutes les visualisations, medias et details sont presentes ici."
      />
      {loading ? <p className="muted">Chargement des projets...</p> : null}
      {error ? <p className="muted">{error}</p> : null}
      <ProjectGrid projects={items} />
    </div>
  );
}
