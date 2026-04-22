import { Link, NavLink } from "react-router-dom";
import { isAuthenticated } from "../../auth";
import styles from "./Header.module.css";

const logo = "/logo cerema.png";

export function Header() {
  const authenticated = isAuthenticated();
  const navItems = [
    { label: "Accueil", to: "/" },
    { label: "Realisations", to: "/projets" },
    { label: "Demonstrations", to: "/showcase" },
    { label: "Contextes", to: "/contextes" },
    { label: "Methode", to: "/process" },
    { label: "Quiz", to: "/quiz" },
    authenticated
      ? { label: "Dashboard", to: "/dashboardhome" }
      : { label: "Connexion", to: "/connexion" },
  ];

  return (
    <header className={styles.shell}>
      <div className={`container ${styles.bar}`}>
        <Link to="/" className={styles.brand}>
          <div className={styles.logoImg} aria-hidden>
            <img src={logo} alt="Cerema" />
          </div>
          <div>
            Equipe jumeaux numeriques
            <br />
            <span style={{ fontWeight: 500, color: "var(--color-text-muted)" }}>
              Data viz & 3D pour les territoires
            </span>
          </div>
        </Link>
        <nav className={styles.nav} aria-label="Principale">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.link} ${isActive ? "pill" : ""}`
              }
              end={item.to === "/"}
            >
              {item.label}
            </NavLink>
          ))}
          <Link to="/contact">
            <button className={styles.cta}>Contact</button>
          </Link>
        </nav>
        <button className={styles.mobileToggle} aria-label="Ouvrir le menu">
          Menu
        </button>
      </div>
    </header>
  );
}
