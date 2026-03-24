export type Media = {
  type: "image" | "video" | "3d";
  title: string;
  src?: string;
};

export type Project = {
  slug: string;
  title: string;
  summary: string;
  domain: string;
  location: string;
  role: string;
  contribution: string[];
  context: string;
  solution: string[];
  impacts: string[];
  tags: string[];
  media: Media[];
  technologies: string[];
  heroImage?: string;
};

export const projects: Project[] = [
  {
    slug: "noisy-le-grand-prospective-scolaire",
    title: "Noisy-le-Grand – Prospective scolaire",
    summary:
      "Jumeau numérique pour anticiper les effectifs scolaires, équilibrer la carte et simuler les besoins à 10 ans.",
    domain: "Jumeau numérique urbain",
    location: "Noisy-le-Grand",
    role: "Pilotage Cerema + équipe jumeaux numériques",
    contribution: [
      "Co-conception avec la collectivité",
      "Modélisation des scénarios et UX data",
      "Intégration front & visualisation carto",
    ],
    context:
      "Croissance démographique et rééquilibrage des établissements à planifier.",
    solution: [
      "Modélisation des scénarios à 10 ans par quartier",
      "Prédiction des effectifs par établissement",
      "Visualisation interactive des déséquilibres",
      "Recommandations d'ajustement de la carte scolaire",
    ],
    impacts: [
      "Décisions objectivées pour les élus",
      "Anticipation des pics de capacité",
      "Dialogue simplifié avec l'Éducation nationale",
    ],
    tags: ["Éducation", "Prospective", "Simulation", "Data"],
    media: [
      { type: "image", title: "Vue 3D Noisy-le-Grand", src: "/Image 1 noisy le grand.png" },
      { type: "image", title: "Simulation scolaire", src: "/Image 2 noisy .png" },
    ],
    technologies: ["Data science", "Cartographie interactive", "React"],
    heroImage: "/imagenoisy.jpg",
  },
  {
    slug: "paris-petit-tertiaire-energie",
    title: "Ville de Paris – Consommation énergétique du petit tertiaire",
    summary:
      "Plateforme de visualisation des consommations électricité et gaz du petit tertiaire, multi-échelles (arrondissement, quartier, IRIS).",
    domain: "Transition énergétique",
    location: "Paris",
    role: "Data viz & dashboards énergie",
    contribution: [
      "Design des indicateurs et filtres multi-échelles",
      "Intégration cartographique et dashboards",
      "Conseil sur la lisibilité des KPIs publics",
    ],
    context:
      "Orienter les politiques publiques de transition énergétique sur les filières les plus énergivores.",
    solution: [
      "Tableaux de bord cartographiques multi-échelles",
      "Indicateurs par filière et intensité énergétique",
      "Comparaison spatio-temporelle et filtres avancés",
    ],
    impacts: [
      "Ciblage des zones à fort potentiel de réduction",
      "Pilotage des aides et investissements",
      "Sensibilisation des acteurs locaux",
    ],
    tags: ["Énergie", "Données territoriales", "Dashboard"],
    media: [
      { type: "image", title: "Dashboard consommation (kWh)", src: "/Image 1 Paris conso(kwh).png" },
      { type: "image", title: "Performance énergétique", src: "/Image 2 Paris performence energétique.png" },
    ],
    technologies: ["React", "Map/Deck.gl", "API énergie"],
    heroImage: "/imageparis.jpg",
  },
  {
    slug: "ceremap3d-signalisation-bordeaux",
    title: "CereMap3D – Signalisation verticale à Bordeaux",
    summary:
      "Plateforme 3D de collecte, traitement et visualisation des panneaux de signalisation, avec navigation dans une scène urbaine.",
    domain: "Jumeau 3D / Mobilité",
    location: "Bordeaux",
    role: "Intégration 3D & pipeline data terrain",
    contribution: [
      "Structuration du pipeline collecte > traitement > restitution",
      "UX 3D (caméra guidée, filtres typologies)",
      "Optimisation performance pour le web",
    ],
    context:
      "Valoriser les données terrain issues d’un véhicule de collecte pour fiabiliser l’inventaire de signalisation.",
    solution: [
      "Pipeline de collecte > traitement > restitution 3D",
      "Visualisateur 3D avec caméra guidée",
      "Filtres par typologie de panneaux et état",
    ],
    impacts: [
      "Suivi qualité du patrimoine de signalisation",
      "Aide à la planification des interventions",
      "Réduction des tournées de repérage",
    ],
    tags: ["3D", "Mobilité", "Signalisation", "Data terrain"],
    media: [
      { type: "image", title: "Animation Aperçu", src: "/animation.gif" },
      { type: "image", title: "GIF Visualisateur", src: "/2026-03-24-14-02-02.gif" },
    ],
    technologies: ["Cesium / Three.js", "React", "Data pipeline"],
    heroImage: "/imageceremap3d.jpg",
  },
];
