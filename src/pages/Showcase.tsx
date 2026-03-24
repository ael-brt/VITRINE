import { SectionTitle } from "../components/SectionTitle/SectionTitle";
import { MediaGallery } from "../components/MediaGallery/MediaGallery";
import { ThreeDPreview } from "../components/ThreeDPreview/ThreeDPreview";

export function Showcase() {
  return (
    <div className="container" style={{ padding: "72px 0" }}>
      <SectionTitle
        eyebrow="Démonstrations"
        title="Visualisations et 3D"
        description="Sélection de médias prêts pour les supports de communication : vidéos 3D, dashboards et aperçu interactif."
      />
      <MediaGallery
        items={[
          { type: "image", title: "Vue 3D Noisy-le-Grand", src: "/Image 1 noisy le grand.png" },
          { type: "image", title: "Simulation scolaire", src: "/Image 2 noisy .png" },
          { type: "image", title: "Dashboard énergie Paris", src: "/Image 1 Paris conso(kwh).png" },
          { type: "image", title: "Performance énergétique", src: "/Image 2 Paris performence energétique.png" },
        ]}
      />
      <ThreeDPreview
        title="CereMap3D — Aperçu interactif"
        ctaLabel="Lancer la scène"
      />
    </div>
  );
}
