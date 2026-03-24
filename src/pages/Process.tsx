import { useState } from "react";
import { SectionTitle } from "../components/SectionTitle/SectionTitle";

const steps = [
  {
    title: "Étape 1 · Idéation",
    detail:
      "Dessiner le cas d’usage, questionner le pourquoi, intégrer le Numérique Responsable et préparer une analyse coûts-bénéfices.",
    extra: [
      "Dessiner le cas d’usage et les bénéficiaires",
      "Questionner le projet sous l’angle Numérique Responsable",
      "Préparer l’analyse coûts / bénéfices",
      "Ateliers recommandés pour cadrer",
    ],
    image: "/imageideation.png",
  },
  {
    title: "Étape 2 · Spécifications",
    detail:
      "Identifier les persona, formaliser fonctionnalités et indicateurs, définir le cycle de vie des données et les actions d’accès/exploitation.",
    extra: [
      "Persona et besoins par métier",
      "Fonctionnalités et indicateurs ciblés",
      "Cycle de vie des données et plan d’actions",
      "Prêt à passer au prototypage",
    ],
    image: "/imagespecification.png",
  },
  {
    title: "Étape 3 · Prototypage",
    detail:
      "Prouver la faisabilité avec des données réelles, modéliser entités/relations (NGSI-LD), tester la valeur d’usage auprès des métiers.",
    extra: [
      "Prérequis : cas d’usage priorisé, données accessibles",
      "Objectifs : faisabilité technique et valeur d’usage",
      "Modélisation entités/relations (NGSI-LD) et interop",
      "Tests utilisateurs itératifs sur un périmètre réduit",
    ],
    image: "/imageprototypage.png",
  },
  {
    title: "Étape 4 · Industrialisation",
    detail:
      "Normaliser les flux, sécuriser l’architecture, automatiser la qualité et préparer le passage à l’échelle (infra, supervision, accès).",
    extra: [
      "Normalisation des flux et des schémas",
      "Qualité et supervision automatisées",
      "Sécurité et gestion des accès",
      "Infra scalable prête pour le déploiement",
    ],
  },
  {
    title: "Étape 5 · Déploiement & transfert",
    detail:
      "Mise en prod, documentation, formation, réutilisation des communs et gouvernance data continue.",
    extra: [
      "Build statique, CI/CD et prévisualisations",
      "Documentation et formation des équipes locales",
      "Réutilisation des communs (modèles, ontologies, code)",
      "Gouvernance et amélioration continue",
    ],
    image: "/imagedeploiement.png",
  },
];

export function Process() {
  const [selected, setSelected] = useState(0);
  const current = steps[selected];

  return (
    <div className="container" style={{ padding: "72px 0" }}>
      <SectionTitle
        eyebrow="Méthode"
        title="Comment on travaille avec les collectivités"
        description="Une séquence claire qui relie besoins métiers, data/NGSI-LD, prototypage et déploiement Render."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 320px) 1fr",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {steps.map((step, idx) => (
            <div
              key={step.title}
              style={{
                position: "relative",
                padding: "16px 14px",
                borderRadius: 14,
                border: "1px solid var(--color-border)",
                background: selected === idx ? "rgba(239,125,0,0.08)" : "#fff",
                boxShadow: selected === idx ? "0 12px 32px rgba(239,125,0,0.12)" : "0 10px 30px rgba(0,0,0,0.06)",
                cursor: "pointer",
              }}
              onClick={() => setSelected(idx)}
            >
              <div className="eyebrow">Étape {idx + 1}</div>
              <div style={{ fontWeight: 700, margin: "6px 0" }}>{step.title}</div>
              <div className="muted" style={{ lineHeight: 1.5 }}>{step.detail}</div>
              {idx < steps.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    bottom: -18,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 2,
                    height: 26,
                    background: "var(--color-primary)",
                  }}
                />
              )}
              {idx < steps.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    bottom: -26,
                    left: "calc(50% - 7px)",
                    width: 14,
                    height: 14,
                    transform: "rotate(45deg)",
                    borderRight: "2px solid var(--color-primary)",
                    borderBottom: "2px solid var(--color-primary)",
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: 24, position: "sticky", top: 120, minHeight: 320 }}>
          <div className="eyebrow">Détail</div>
          <h3 style={{ marginTop: 6 }}>{current.title}</h3>
          <p className="muted" style={{ lineHeight: 1.5 }}>{current.detail}</p>
          {current.image && (
            <div
              style={{
                marginTop: 12,
                borderRadius: 14,
                overflow: "hidden",
                border: "1px solid var(--color-border)",
              }}
            >
              <img src={current.image} alt={current.title} style={{ width: "100%", display: "block" }} />
            </div>
          )}
          <ul style={{ color: "var(--color-text)", marginTop: 12 }}>
            {current.extra.map((line) => (
              <li key={line} style={{ marginBottom: 6 }}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
