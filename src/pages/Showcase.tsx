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
          { type: "image", title: "CereMap3D — animation", src: "/animation.gif" },
          { type: "image", title: "CereMap3D — GIF", src: "/2026-03-24-14-02-02.gif" },
        ]}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Les rendus CereMap3D présentés ici sont issus d’AutoCAD Civil 3D sur la base des données CeremaP3D interprétées par TCP.
      </p>
      <ThreeDPreview
        title="CereMap3D — Animation"
        ctaLabel="Voir l’animation"
        onOpen={() => window.open("/2026-03-24-14-02-02.gif", "_blank")}
      />
    </div>
  );
}
