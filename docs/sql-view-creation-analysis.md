# Analyse de la creation des views DataHub

Cette note détaille le fonctionnement des vues dans le projet Vitrine CEREMA.

Le terme "view" recouvre trois choses différentes dans le code :

- les vues Django/DRF dans `backend/apps/datahub/views.py`, qui exposent l'API ;
- les `SqlView` dans `backend/apps/datahub/models.py`, configurées depuis Django Admin ;
- les vues SQL physiques PostgreSQL créées en base par `backend/apps/datahub/sql_views.py`.

La création de vue qui structure les dashboards est la `SqlView`.

## Position dans l'architecture

Flux global :

```text
Tenant + EntityTable
        |
        | import NGSI-LD via Celery
        v
Table physique PostgreSQL dynamique
        |
        | SELECT configuré en admin
        v
SqlView Django
        |
        | deploy_sql_view()
        v
VIEW ou MATERIALIZED VIEW PostgreSQL
        |
        | endpoints /api/v1
        v
Dashboard React
```

Une `SqlView` sert donc de couche de transformation entre les données brutes importées et les interfaces métier.

## Modèle SqlView

Définition : `backend/apps/datahub/models.py`.

Champs structurants :

- `slug` : identifiant fonctionnel stable. Il est utilisé dans les URLs API `/api/v1/datahub/sqlviews/<slug>/...` ;
- `name` : nom lisible ;
- `storage_mode` : `view` ou `materialized_view` ;
- `sql_query` : requête `SELECT` source ;
- `db_relation_name` : nom de la relation réellement créée en base ;
- `environments` : environnements autorisés à consommer la vue via l'API ;
- `is_active` : exposition ou non dans l'API ;
- `last_refresh_at`, `last_refresh_status`, `last_refresh_error` : suivi de déploiement/rafraîchissement.

`db_relation_name` est unique. Si le champ est vide, l'admin génère un nom de type :

```text
dh_view_<slug>
```

## Création depuis Django Admin

La création passe par `SqlViewAdmin.save_model()` dans `backend/apps/datahub/admin.py`.

Séquence exacte :

1. L'administrateur crée ou modifie une `SqlView`.
2. Si `db_relation_name` est vide, l'admin le génère depuis le `slug`.
3. Django sauvegarde l'objet `SqlView`.
4. `deploy_sql_view(obj)` est appelé.
5. En cas d'erreur de validation ou SQL, un message d'erreur est affiché dans l'admin.

Point important : l'objet Django peut être sauvegardé même si le déploiement SQL échoue, car `super().save_model()` est appelé avant `deploy_sql_view()`.

Cela permet de corriger la requête ensuite, mais cela signifie aussi qu'une `SqlView` peut exister en admin sans relation SQL valide.

## Déploiement SQL

Le déploiement est dans `backend/apps/datahub/sql_views.py`.

Fonction principale :

```python
deploy_sql_view(view: SqlView) -> str
```

Elle fait quatre choses :

1. valide la requête avec `_validate_select_sql()` ;
2. calcule le nom de relation SQL avec `_relation_name()` ;
3. supprime l'ancienne relation du même nom ;
4. crée une `VIEW` ou `MATERIALIZED VIEW`.

SQL exécuté :

```sql
DROP MATERIALIZED VIEW IF EXISTS <relation>;
DROP VIEW IF EXISTS <relation>;
CREATE OR REPLACE VIEW <relation> AS <query>;
```

ou, pour une vue matérialisée :

```sql
DROP MATERIALIZED VIEW IF EXISTS <relation>;
DROP VIEW IF EXISTS <relation>;
CREATE MATERIALIZED VIEW <relation> AS <query>;
```

Après succès :

- `db_relation_name` est enregistré ;
- `last_refresh_status` passe à `ready` ;
- `last_refresh_error` est vidé.

## Validation de la requête

La fonction `_validate_select_sql()` applique une validation défensive.

Règles :

- la requête doit commencer par `SELECT` ;
- les points-virgules sont interdits ;
- les commentaires SQL `--`, `/*`, `*/` sont interdits ;
- les mots-clés destructeurs ou de mutation sont interdits : `insert`, `update`, `delete`, `drop`, `alter`, `create`, `grant`, `revoke`, `truncate` ;
- `execute` et `pg_sleep(` sont interdits ;
- les relations dans les clauses `FROM` et `JOIN` doivent être connues.

Relations autorisées :

- tous les `EntityTable.table_name` existants ;
- tous les `SqlView.db_relation_name` déjà déployés.

Conséquence pratique : une vue peut dépendre d'une autre vue, mais la vue source doit déjà être déployée.

## Limites de la validation SQL

La validation actuelle est utile, mais elle reste simple.

Points solides :

- empêche la plupart des requêtes destructives évidentes ;
- limite les sources aux tables DataHub et vues déjà connues ;
- empêche les requêtes multi-statements avec `;`.

Points fragiles :

- le parsing des relations repose sur une expression régulière, pas sur un parseur SQL ;
- les CTE complexes, sous-requêtes imbriquées ou alias inhabituels peuvent être mal détectés ;
- le test `lower(sql_query) LIKE %table_name%` utilisé avant suppression d'une table est approximatif ;
- `DROP VIEW` et `DROP MATERIALIZED VIEW` au déploiement peuvent échouer si d'autres vues dépendent déjà de cette relation ;
- `last_refresh_error` n'est pas alimenté en cas d'échec de `deploy_sql_view()` dans l'admin, seul un message admin est affiché.

Pour des vues critiques, il faut relire manuellement la requête.

## View classique ou materialized view

### `view`

Avantages :

- toujours à jour après un import ;
- pas de rafraîchissement manuel ;
- convient aux requêtes simples ou aux petits volumes.

Inconvénients :

- chaque appel API réexécute la requête ;
- peut devenir lente si la requête fait des jointures lourdes.

### `materialized_view`

Avantages :

- lecture plus rapide côté API ;
- utile pour des jointures ou agrégations coûteuses.

Inconvénients :

- les données sont figées jusqu'au prochain refresh ;
- après un import, il faut lancer `Refresh selected materialized views` ;
- le refresh peut être coûteux.

## Refresh des materialized views

Fonction :

```python
refresh_materialized_view(view: SqlView) -> None
```

Elle refuse les vues classiques.

SQL exécuté :

```sql
REFRESH MATERIALIZED VIEW <relation>;
```

Après succès :

- `last_refresh_at` est mis à jour ;
- `last_refresh_status` passe à `success` ;
- `last_refresh_error` est vidé.

## Consommation API des SqlView

Endpoints directs :

```text
GET /api/v1/datahub/sqlviews/
GET /api/v1/datahub/sqlviews/<slug>/rows/
GET /api/v1/datahub/sqlviews/<slug>/geojson/
```

`/rows/` retourne les lignes brutes de la relation SQL avec pagination.

`/geojson/` convertit les lignes en `FeatureCollection`. Le backend cherche une géométrie dans ces colonnes :

- `geometry` ;
- `localisation_geojson` ;
- `c_localisation_geojson` ;
- `here_payload_json`.

Pour une carte GeoJSON, la `SqlView` doit donc exposer une colonne compatible.

## Consommation par les dashboards

Les dashboards sont définis par le modèle `Dashboard`.

Un dashboard peut pointer vers une `SqlView` via `Dashboard.sql_view`.

Endpoints utilisés par le frontend :

```text
GET /api/v1/dashboards/
GET /api/v1/dashboards/<slug>/
GET /api/v1/dashboards/<slug>/data/
GET /api/v1/dashboards/<slug>/kpis/
GET /api/v1/dashboards/<slug>/joined/
GET /api/v1/dashboards/<slug>/map/
```

Le code backend actuel lit surtout le nombre de lignes de la `SqlView`. L'endpoint `/map/` lit toutes les colonnes paginées et reconstruit des items cartographiques.

Pour `/map/`, les champs utiles sont :

- `entity_id` ou `id` pour l'identifiant ;
- `entity_type` pour le type ;
- `tenant_id` pour le tenant ;
- `aPourTronconDeRoute` ou `entity_id` pour la clé de jointure ;
- `scope` ;
- `geometry`, `localisation_geojson` ou `c_localisation_geojson`.

## Contrat réel avec le frontend

Le dashboard home liste les dashboards renvoyés par `/api/v1/dashboards/`, mais les routes React sont codées en dur.

Routes existantes :

- `/dashboards/floatingcardata` ;
- `/dashboards/secteurscolaire` ;
- `/dashboards/ceremap3d`.

Conséquence : créer un nouveau `Dashboard` en admin ne suffit pas à créer une nouvelle page React. Il apparaîtra dans le dashboard home, mais le lien `/dashboards/<slug>` ne fonctionnera que si une route React existe.

### Dashboard `floatingcardata`

La page appelle :

- `GET /api/v1/dashboards/floatingcardata/` ;
- par défaut `GET /api/v1/datahub/sqlviews/troncon_here_join/geojson/`.

Le slug de dashboard et le slug de `SqlView` sont donc découplés ici.

La vue GeoJSON doit exposer :

- une géométrie GeoJSON ;
- des propriétés de jointure comme `aPourTronconDeRoute`, `join_key`, `joinKey`, `routeId`, `segmentId`, `entity_id` ;
- des métriques HERE numériques, par exemple `congestionRatio`, `meanSpeedKmh`, `speedLimitKmh`, `count`, `freeFlow`, etc. ;
- des champs temporels comme `windowStart`, `timestamp`, `date`, `observedAt`, `anchorHour` ou `windowEnd` pour les filtres de date.

### Dashboard `ceremap3d`

La page appelle :

- `GET /api/v1/dashboards/ceremap3d/` ;
- `GET /api/v1/dashboards/ceremap3d/kpis/` ;
- `GET /api/v1/dashboards/ceremap3d/map/?page=1&page_size=1000`.

La `SqlView` liée au dashboard doit exposer une géométrie exploitable par `/map/`.

Champs à privilégier :

- `entity_id` ;
- `entity_type` ;
- `tenant_id` ;
- `aPourTronconDeRoute` ;
- `scope` ;
- `geometry` ou `localisation_geojson`.

### Dashboard `secteurscolaire`

La page appelle :

- `GET /api/v1/dashboards/secteurscolaire/` ;
- `GET /api/v1/dashboards/secteurscolaire/data/`.

Le backend actuel retourne uniquement :

- `total_entities` ;
- `stats.line_count` ;
- `stats.point_count` ;
- `stats.unknown_geometry_count`.

La `SqlView` liée sert donc surtout à fournir un nombre de lignes.

## Permissions

Les permissions sont basées sur les environnements.

Pour une `SqlView` :

- si `is_active=False`, elle est inaccessible ;
- si aucun environnement n'est associé, elle est accessible à tout utilisateur authentifié ;
- si des environnements sont associés, l'utilisateur doit appartenir à un groupe actif qui donne accès à au moins un de ces environnements.

Pour un `Dashboard` :

- si `is_active=False`, il est invisible ;
- si `is_protected=True` et que des environnements sont associés, l'utilisateur doit avoir accès à au moins un de ces environnements ;
- si `is_protected=True` mais aucun environnement n'est associé, le code actuel le laisse passer pour tout utilisateur authentifié.

## Exemple de création d'une SqlView simple

Objectif : exposer les entités d'une table `ent_signalisationverticale`.

```sql
SELECT
  id,
  tenant_id,
  entity_type,
  entity_id,
  localisation_geojson AS geometry,
  aPourTronconDeRoute,
  scope,
  updated_at
FROM ent_signalisationverticale
```

Puis dans l'admin :

1. créer `SqlView` ;
2. `slug` : `signalisation_map` ;
3. `storage_mode` : `view` ;
4. coller la requête ;
5. associer les environnements ;
6. enregistrer ;
7. utiliser `Voir données`.

## Exemple pour `ceremap3d`

Si le dashboard `ceremap3d` doit lire cette vue :

1. créer ou modifier une `SqlView` ;
2. vérifier que la relation déployée contient les champs attendus par `/map/` ;
3. créer ou modifier le `Dashboard` avec `slug=ceremap3d` ;
4. associer la `SqlView` au dashboard ;
5. associer les mêmes environnements côté `Dashboard` et `SqlView` ;
6. tester `/api/v1/dashboards/ceremap3d/map/?page=1&page_size=10`.

Requête type :

```sql
SELECT
  id,
  tenant_id,
  entity_type,
  entity_id,
  localisation_geojson AS geometry,
  aPourTronconDeRoute,
  scope,
  updated_at
FROM ent_signalisationverticale
WHERE localisation_geojson IS NOT NULL
```

## Exemple pour `floatingcardata`

La page `floatingcardata` lit par défaut la `SqlView` de slug `troncon_here_join`.

Créer une vue avec ce slug, puis produire une relation contenant une géométrie et des métriques.

Exemple de forme attendue :

```sql
SELECT
  t.entity_id,
  t.localisation_geojson AS geometry,
  t.aPourTronconDeRoute,
  h.windowStart,
  h.congestionRatio,
  h.meanSpeedKmh,
  h.speedLimitKmh,
  h.count,
  h.freeFlow,
  t.scope
FROM ent_troncon t
JOIN ent_here h
  ON h.aPourTronconDeRoute = t.entity_id
```

Les noms exacts de tables et colonnes dépendent des entités importées. Il faut les vérifier avec `Voir données` sur chaque `EntityTable`.

## Points à corriger ou améliorer

### 1. Stocker l'erreur de déploiement

Aujourd'hui, en cas d'échec de `deploy_sql_view()` depuis l'admin, l'erreur est affichée mais `last_refresh_error` n'est pas forcément enregistré.

Amélioration recommandée :

- mettre `last_refresh_status="failed"` ;
- écrire `last_refresh_error=str(exc)`.

### 2. Ajouter une validation avant sauvegarde

Actuellement, l'objet admin est sauvegardé avant le déploiement SQL.

Option possible :

- valider la requête dans le formulaire admin avant `save_model()` ;
- éviter d'enregistrer une configuration manifestement invalide.

### 3. Utiliser un parseur SQL

La validation par regex est fragile.

Un parseur SQL comme `sqlparse` permettrait de mieux identifier les relations sources, les CTE et les sous-requêtes.

### 4. Gérer les dépendances entre vues

Le redéploiement supprime puis recrée la relation.

S'il existe des vues dépendantes, PostgreSQL peut refuser le drop. Il faudrait :

- afficher les vues dépendantes ;
- documenter l'ordre de déploiement ;
- ou gérer explicitement les dépendances.

### 5. Aligner le frontend sur des dashboards dynamiques

Le dashboard home est dynamique, mais les routes dashboard sont statiques.

Créer un dashboard en admin ne crée pas automatiquement une page fonctionnelle.

Deux options :

- assumer trois dashboards métiers fixes et documenter les slugs obligatoires ;
- créer une page générique `/dashboards/:slug` qui lit le contrat API.

### 6. Spécialiser les KPIs

Les endpoints `/data/`, `/kpis/` et `/joined/` retournent actuellement des métriques génériques.

Pour des dashboards métier, les KPIs devraient être calculés à partir de colonnes précises de la `SqlView`.

## Checklist de validation d'une SqlView

Avant de considérer une vue comme prête :

- la requête commence par `SELECT` ;
- toutes les tables sources existent dans `EntityTable.table_name` ou `SqlView.db_relation_name` ;
- `Voir données` fonctionne dans l'admin ;
- `/api/v1/datahub/sqlviews/<slug>/rows/` répond ;
- si c'est une carte, `/api/v1/datahub/sqlviews/<slug>/geojson/` ou `/api/v1/dashboards/<slug>/map/` contient des géométries ;
- les environnements sont renseignés ;
- un utilisateur non-admin autorisé peut lire la vue ;
- un utilisateur non autorisé reçoit bien `403` ;
- si la vue est matérialisée, le refresh est testé après import.

