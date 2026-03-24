import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.shell}>
      <div className="container">
        <div className={styles.grid}>
          <div>
            <div className={styles.title}>Cerema</div>
            <p className={styles.muted}>
              Environnement numérique pour les jumeaux numériques, la data
              visualisation et l’IA territoriale. Solutions au service des
              collectivités.
            </p>
          </div>
          <div>
            <div className={styles.title}>Nous contacter</div>
            <p className={styles.muted}>
              Email : contact@cerema.fr<br />
              Téléphone : +33 (0)1 00 00 00 00<br />
              Adresse : 12 rue des Territoires, 75000 Paris
            </p>
          </div>
          <div>
            <div className={styles.title}>Suivre</div>
            <p className={styles.muted}>
              LinkedIn · Twitter · GitHub<br />
              Newsletter “Innovation territoriale”
            </p>
          </div>
        </div>
        <div className={styles.legal}>
          © {new Date().getFullYear()} Cerema — Jumeaux numériques & data
          territoriale. Mentions légales.
        </div>
      </div>
    </footer>
  );
}
