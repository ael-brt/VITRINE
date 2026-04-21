import { ProjectCard } from "../ProjectCard/ProjectCard";
import type { Project } from "../../types/domain";

interface Props {
  projects: Project[];
}

export function ProjectGrid({ projects }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: "28px",
      }}
    >
      {projects.map((project) => (
        <ProjectCard key={project.slug} project={project} />
      ))}
    </div>
  );
}
