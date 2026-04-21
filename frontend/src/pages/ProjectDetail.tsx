import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchProjectBySlug } from "../api/client";
import { MediaGallery } from "../components/MediaGallery/MediaGallery";
import { SectionTitle } from "../components/SectionTitle/SectionTitle";
import { ThreeDPreview } from "../components/ThreeDPreview/ThreeDPreview";
import { projects as fallbackProjects } from "../data/projects";
import type { Project } from "../types/domain";

export function ProjectDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const fallbackProject = fallbackProjects.find((p) => p.slug === slug);

  const [project, setProject] = useState<Project | undefined>(fallbackProject);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const currentSlug = slug ?? "";

    if (!currentSlug) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const result = await fetchProjectBySlug(currentSlug);

        if (!cancelled) {
          setProject(result);
          setError(null);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossible de charger ce projet depuis l'API.",
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
  }, [slug]);

  if (!project) {
    return (
      <div className="container" style={{ padding: "64px 0" }}>
        <p>Projet introuvable.</p>
        {error ? <p className="muted">{error}</p> : null}
      </div>
    );
  }

  const heroBackground = project.heroImage ? `url('${project.heroImage}')` : undefined;

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
          style={{
            fontSize: 18,
            maxWidth: 760,
            color: heroBackground ? "rgba(255,255,255,0.9)" : undefined,
          }}
        >
          {project.summary}
        </p>
        <div style={{ marginTop: 12, fontWeight: 600 }}>{project.role}</div>
      </div>

      <div className="container" style={{ padding: "64px 0" }}>
        {loading ? <p className="muted">Chargement du projet...</p> : null}
        {error ? <p className="muted">{error}</p> : null}

        <section style={{ marginTop: "32px" }}>
          <SectionTitle eyebrow="Contexte" title="Defi" description={project.context} />
        </section>

        <section style={{ marginTop: "24px" }}>
          <SectionTitle eyebrow="Solution" title="Ce que nous avons livre" />
          <ul>
            {project.solution.map((item) => (
              <li key={item} style={{ marginBottom: 8, color: "var(--color-text)" }}>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section style={{ marginTop: "24px" }}>
          <SectionTitle eyebrow="Notre contribution" title="Ce qu'a fait l'equipe" />
          <ul>
            {project.contribution.map((item) => (
              <li key={item} style={{ marginBottom: 8, color: "var(--color-text)" }}>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section style={{ marginTop: "24px" }}>
          <SectionTitle eyebrow="Impacts" title="Apports pour la collectivite" />
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
            eyebrow="Medias"
            title="Captures, videos et 3D"
            description="Integration prete a accueillir les fichiers finaux."
          />
          <MediaGallery items={project.media} />
        </section>

        {project.media.some((m) => m.type === "3d") ? (
          <ThreeDPreview
            title="Visualisateur 3D"
            ctaLabel="Ouvrir en plein ecran"
            onOpen={() => navigate("/showcase")}
          />
        ) : null}

        <section style={{ marginTop: "32px" }}>
          <SectionTitle eyebrow="Technologies" title="Stack utilisee" />
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
