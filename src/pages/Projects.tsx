import { SectionTitle } from "../components/SectionTitle/SectionTitle";
import { ProjectGrid } from "../components/ProjectGrid/ProjectGrid";
import { projects } from "../data/projects";

export function Projects() {
  return (
    <div className="container" style={{ padding: "72px 0" }}>
      <SectionTitle
        eyebrow="Réalisations"
        title="Découvrir les projets"
        description="Toutes les visualisations, médias et détails sont présentés ici."
      />
      <ProjectGrid projects={projects} />
    </div>
  );
}
