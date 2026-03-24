import styles from "./Hero.module.css";

interface Props {
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}

export function Hero({ onPrimaryClick, onSecondaryClick }: Props) {
  return (
    <section className={styles.shell}>
      <div>
        <span className="eyebrow">Fabric'O · Cerema</span>
        <h1 className={styles.title}>
          La Fabrique Numérique de l'Innovation Territoriale
        </h1>
        <p className={styles.lead}>
          Collectif multi-partenaires du Cerema dédié à la gouvernance des
          données, aux jumeaux numériques et aux services data/IA pour les
          territoires durables.
        </p>
        <div className={styles.ctaRow}>
          <button className={styles.primary} onClick={onPrimaryClick}>
            Voir les projets
          </button>
          <button className={styles.secondary} onClick={onSecondaryClick}>
            Voir les démonstrations
          </button>
        </div>
        <div className={styles.badges}>
          <div className={styles.badge}>Jumeaux numériques</div>
          <div className={styles.badge}>Data visualisation</div>
          <div className={styles.badge}>IA territoriale</div>
        </div>
      </div>
    </section>
  );
}
