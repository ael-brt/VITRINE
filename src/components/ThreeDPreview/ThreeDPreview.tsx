import styles from "./ThreeDPreview.module.css";

interface Props {
  title?: string;
  ctaLabel?: string;
  onOpen?: () => void;
}

export function ThreeDPreview({
  title = "Aperçu du visualisateur 3D",
  ctaLabel = "Ouvrir la démo",
  onOpen,
}: Props) {
  return (
    <div className={styles.shell} role="region" aria-label="Aperçu 3D">
      <div className={styles.toolbar}>
        <div>
          <div className="eyebrow">3D immersive</div>
          <strong>{title}</strong>
        </div>
        <button className={styles.cta} onClick={onOpen}>
          {ctaLabel}
        </button>
      </div>
      <div className={styles.viewport}>
        Vue 3D intégrable (Cesium/Deck.gl/Three.js)
      </div>
    </div>
  );
}
