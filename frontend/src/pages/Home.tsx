import { useNavigate } from "react-router-dom";
import { Hero } from "../components/Hero/Hero";
import { SectionTitle } from "../components/SectionTitle/SectionTitle";
import { Stats } from "../components/Stats/Stats";

export function Home() {
  const navigate = useNavigate();

  return (
    <div className="container">
      <Hero
        onPrimaryClick={() => navigate("/projets")}
        onSecondaryClick={() => navigate("/showcase")}
      />

      <section style={{ marginTop: "32px" }}>
        <SectionTitle
          eyebrow="Présentation"
          title="La Fabrique Numérique de l'Innovation Territoriale (Fabric'O)"
          description="Collectif multi-partenaires du Cerema dédié à la gouvernance des données pour des territoires durables, avec un appui technique aux projets nationaux et territoriaux."
        />
        <p className="muted" style={{ maxWidth: 900, lineHeight: 1.6 }}>
          Fabric'O accompagne les territoires pour co-construire des biens communs numériques, capitaliser et ouvrir API, modèles de données et algorithmes financés sur fonds publics, et éviter les situations de verrouillage fournisseur tout en évaluant l'impact réel des projets « smart ».
        </p>
      </section>

      <section style={{ marginTop: "28px" }}>
        <SectionTitle
          eyebrow="Objectifs"
          title="Fabriquer, avec les territoires, des biens communs en réseau"
          description="Un cadre national pour hyperviseurs, jumeaux numériques, espaces de données et services augmentés d’IA."
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {[
            "Vision partagée & souveraineté des données",
            "Accompagnement et montée en compétences",
            "Projets nationaux pour tester/reutiliser les méthodes",
            "Biens communs : modèles, IA, formations, référentiels",
            "Bac de prototypage pour services interopérables",
            "Veille collaborative & benchmark des plateformes",
            "Passage à l'échelle et normalisation CEN / ISO",
          ].map((item) => (
            <span key={item} className="pill">
              {item}
            </span>
          ))}
        </div>
      </section>
      <section style={{ marginTop: "64px" }}>
        <SectionTitle
          eyebrow="Chiffres clés"
          title="Impact mesurable"
          description="Des gains concrets pour les collectivités : pilotage, planification, maintenance."
        />
        <Stats
          stats={[
            { value: "10 ans", label: "Prospective scolaire simulée" },
            { value: "3 échelles", label: "Arrondissement · quartier · IRIS" },
            { value: "100%", label: "Signalisation inventoriée en 3D" },
            { value: "Ready", label: "Déploiement Render & GitHub" },
          ]}
        />
      </section>
    </div>
  );
}
