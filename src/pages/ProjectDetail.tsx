import { useParams, useNavigate } from "react-router-dom";
import { projects } from "../data/projects";
import { SectionTitle } from "../components/SectionTitle/SectionTitle";
import { MediaGallery } from "../components/MediaGallery/MediaGallery";
import { ThreeDPreview } from "../components/ThreeDPreview/ThreeDPreview";

export function ProjectDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const project = projects.find((p) => p.slug === slug);

  if (!project) {
    return (
      <div className="container" style={{ padding: "64px 0" }}>
        <p>Projet introuvable.</p>
      </div>
    );
  }

  const heroBackground = project.heroImage
    ? `url('${project.heroImage}')`
    : undefined;

  return (
    <>
      <div
        style={{
          padding: "48px 24px",
          width: "100vw",
          marginLeft: "calc(50% - 50vw)",
          borderRadius: 0,
          background: heroBackground
            ? `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.35)), ${heroBackground}`
            : "var(--color-card)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          color: heroBackground ? "#fff" : "inherit",
        }}
      >
        <div className="eyebrow">{project.domain}</div>
        <h1 style={{ fontFamily: "var(--font-heading)", letterSpacing: -0.01 }}>
          {project.title}
        </h1>
        <p
          className="muted"
          style={{ fontSize: 18, maxWidth: 760, color: heroBackground ? "rgba(255,255,255,0.9)" : undefined }}
        >
          {project.summary}
        </p>
        <div style={{ marginTop: 12, fontWeight: 600 }}>{project.role}</div>
      </div>

      <div className="container" style={{ padding: "64px 0" }}>
      <section style={{ marginTop: "32px" }}>
        <SectionTitle
          eyebrow="Contexte"
          title="Défi"
          description={project.context}
        />
      </section>

      <section style={{ marginTop: "24px" }}>
        <SectionTitle
          eyebrow="Solution"
          title="Ce que nous avons livré"
        />
        <ul>
          {project.solution.map((item) => (
            <li key={item} style={{ marginBottom: 8, color: "var(--color-text)" }}>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "24px" }}>
        <SectionTitle eyebrow="Notre contribution" title="Ce qu'a fait l'équipe" />
        <ul>
          {project.contribution.map((item) => (
            <li key={item} style={{ marginBottom: 8, color: "var(--color-text)" }}>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "24px" }}>
        <SectionTitle eyebrow="Impacts" title="Apports pour la collectivité" />
        <ul>
          {project.impacts.map((item) => (
            <li key={item} style={{ marginBottom: 8, color: "var(--color-text)" }}>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "32px" }}>
        <SectionTitle
          eyebrow="Médias"
          title="Captures, vidéos et 3D"
          description="Intégration prête à accueillir les fichiers finaux."
        />
        <MediaGallery items={project.media} />
      </section>

      {project.media.some((m) => m.type === "3d") && (
        <ThreeDPreview
          title="Visualisateur 3D"
          ctaLabel="Ouvrir en plein écran"
          onOpen={() => navigate("/showcase")}
        />
      )}

      <section style={{ marginTop: "32px" }}>
        <SectionTitle eyebrow="Technologies" title="Stack utilisée" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {project.technologies.map((tech) => (
            <span key={tech} className="pill">
              {tech}
            </span>
          ))}
        </div>
      </section>
      </div>
    </>
  );
}
