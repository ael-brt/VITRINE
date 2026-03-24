import { useMemo, useState } from "react";
import { SectionTitle } from "../components/SectionTitle/SectionTitle";

type Question = {
  prompt: string;
  options: string[];
  answer: number;
};

const quizBank = {
  title: "Comprendre un jumeau numérique urbain",
  level: "Découverte",
  questions: [
    {
      prompt: "Quel trio décrit le mieux les briques d'un jumeau numérique territorial ?",
      options: [
        "Capteurs temps réel · 3D/2D · Modèles/IA",
        "Site web · PDF · Newsletter",
        "Réseaux sociaux · Chat · FAQ",
      ],
      answer: 0,
    },
    {
      prompt: "À quoi sert NGSI-LD dans un jumeau numérique ?",
      options: [
        "Un format d'image pour les cartes",
        "Un protocole d'interopérabilité pour décrire et échanger des entités et leurs relations",
        "Une librairie JavaScript pour animer les boutons",
      ],
      answer: 1,
    },
    {
      prompt: "Quelle est la bonne séparation ?",
      options: [
        "Hyperviseur = outil UI, Jumeau numérique = données + calculs + UI",
        "Hyperviseur = IA, Jumeau numérique = diaporama",
        "Hyperviseur = stockage, Jumeau numérique = réseau social",
      ],
      answer: 0,
    },
  ] as Question[],
};

export function Quiz() {
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [score, setScore] = useState<number | null>(null);

  const total = useMemo(() => quizBank.questions.length, []);

  const handleSelect = (qIndex: number, optIndex: number) => {
    setChoices((prev) => ({ ...prev, [qIndex]: optIndex }));
  };

  const handleSubmit = () => {
    let s = 0;
    quizBank.questions.forEach((q, idx) => {
      if (choices[idx] === q.answer) s += 1;
    });
    setScore(s);
  };

  return (
    <div className="container" style={{ padding: "72px 0" }}>
      <SectionTitle
        eyebrow="Quiz & tutoriels"
        title="Tester vos connaissances sur les jumeaux numériques et NGSI-LD"
        description="Une série de mini-tests et parcours guidés pour comprendre les concepts clés, l’interopérabilité et la mise en œuvre."
      />

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div className="eyebrow">{quizBank.level}</div>
        <h2 style={{ margin: "4px 0 16px" }}>{quizBank.title}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {quizBank.questions.map((q, qIndex) => (
            <div key={q.prompt}>
              <strong>{qIndex + 1}. {q.prompt}</strong>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {q.options.map((opt, optIndex) => (
                  <label
                    key={opt}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      padding: "10px 12px",
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      cursor: "pointer",
                      background:
                        choices[qIndex] === optIndex
                          ? "rgba(239, 125, 0, 0.12)"
                          : "white",
                    }}
                  >
                    <input
                      type="radio"
                      name={`q-${qIndex}`}
                      value={optIndex}
                      checked={choices[qIndex] === optIndex}
                      onChange={() => handleSelect(qIndex, optIndex)}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center" }}>
          <button
            onClick={handleSubmit}
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              background: "var(--color-primary)",
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Corriger
          </button>
          {score !== null && (
            <span style={{ fontWeight: 700 }}>
              Score : {score}/{total} {score === total ? "🎯" : ""}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
        }}
      >
        {[
          "Prendre en main NGSI-LD",
          "Data pipeline territoriale",
          "IA territoriale sobre",
        ].map((title) => (
          <div key={title} className="card" style={{ padding: 20 }}>
            <div className="eyebrow">À suivre</div>
            <h3 style={{ marginTop: 10, marginBottom: 12 }}>{title}</h3>
            <p className="muted" style={{ marginBottom: 8 }}>
              Bientôt disponible.
            </p>
            <button
              style={{
                marginTop: 8,
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                background: "white",
                fontWeight: 700,
                cursor: "not-allowed",
                color: "var(--color-text-muted)",
              }}
              disabled
            >
              À venir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
