import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { isAuthenticated, login } from "../auth";
import styles from "./Login.module.css";

export function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated()) {
    return <Navigate to="/welcome" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const success = await login(username, password);
    setLoading(false);

    if (!success) {
      setError("Identifiants invalides.");
      return;
    }

    navigate("/welcome", { replace: true });
  }

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <div className={styles.eyebrow}>Espace securise</div>
        <h1 className={styles.title}>Connexion aux tableaux de bord</h1>
        <p className={styles.description}>
          Connectez-vous pour acceder a la page d'accueil des dashboards et aux
          cartes thematiques.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Identifiant
            <input
              className={styles.input}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>

          <label className={styles.label}>
            Mot de passe
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <div className={styles.actions}>
            <button className={styles.submit} type="submit" disabled={loading}>
              {loading ? "Connexion..." : "Se connecter"}
            </button>
            <span className={styles.hint}>
              Authentification centralisee par le backend Django
            </span>
          </div>
        </form>

        {error ? <div className={styles.error}>{error}</div> : null}
      </section>
    </div>
  );
}
