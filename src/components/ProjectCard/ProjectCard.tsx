import { Link } from "react-router-dom";
import styles from "./ProjectCard.module.css";
import type { Project } from "../../data/projects";

interface Props {
  project: Project;
}

export function ProjectCard({ project }: Props) {
  const firstMedia = project.media[0];
  const bgStyle =
    (project.heroImage || (firstMedia?.src && firstMedia.type === "image"))
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.35)), url(${
            project.heroImage || firstMedia?.src
          })`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : undefined;

  return (
    <article className={`${styles.card} fade-in`}>
      <Link to={`/projets/${project.slug}`} className={styles.media} style={bgStyle} aria-label={project.title} />
      <div className="pill">{project.domain}</div>
      <div className={styles.title}>{project.title}</div>
      <div className="muted" style={{ fontWeight: 600 }}>{project.role}</div>
      <p className={styles.description}>{project.summary}</p>
      <div className={styles.tags}>
        {project.tags.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
      </div>
      <div className={styles.actions}>
        <Link to={`/projets/${project.slug}`} className={styles.link}>
          Voir le projet →
        </Link>
        <span className="muted" style={{ fontSize: 14 }}>
          {project.location}
        </span>
      </div>
    </article>
  );
}
