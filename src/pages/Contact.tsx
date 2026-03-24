import { SectionTitle } from "../components/SectionTitle/SectionTitle";

export function Contact() {
  return (
    <div className="container" style={{ padding: "72px 0" }}>
      <SectionTitle
        eyebrow="Contact"
        title="Construisons vos prochains jumeaux numériques"
        description="Écrivez-nous pour planifier une démonstration ou une étude de faisabilité."
      />
      <div className="card" style={{ padding: 24 }}>
        <p style={{ marginBottom: 12 }}>
          Email : <a href="mailto:contact@cerema.fr">contact@cerema.fr</a>
        </p>
        <p style={{ marginBottom: 12 }}>Téléphone : +33 (0)1 00 00 00 00</p>
        <p className="muted">
          Nous répondons sous 48h ouvrées et pouvons organiser une session live
          sur les démonstrateurs (3D, dashboards, IA territoriale).
        </p>
      </div>
    </div>
  );
}
