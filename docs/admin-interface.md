# Documentation d'utilisation de l'interface administrateur

Cette documentation décrit l'utilisation de l'interface Django Admin du backend Vitrine CEREMA.

L'admin sert à configurer le DataHub : sources NGSI-LD/Stellio, environnements, droits d'accès, tables d'entités, imports, vues SQL et dashboards exposés au frontend.

## Accès à l'administration

URL locale par défaut :

```text
http://127.0.0.1:8000/admin/
```

Avec la stack Docker complète, le backend est exposé par défaut sur :

```text
http://localhost:18000/admin/
```

Un compte `staff` ou `superuser` Django est nécessaire pour se connecter.

Création d'un superutilisateur en local :

```powershell
cd backend
python manage.py createsuperuser
```

## Pré-requis techniques

Avant d'utiliser les imports depuis l'admin :

- les migrations doivent être appliquées avec `python manage.py migrate` ;
- le worker Celery doit être lancé pour exécuter les imports asynchrones ;
- Redis doit être disponible si la configuration Celery ou le cache Redis est activé ;
- la base PostgreSQL est recommandée, car les tables dynamiques utilisent `jsonb`, `BIGSERIAL` et des index PostgreSQL ;
- les secrets OAuth NGSI-LD doivent être présents dans les variables d'environnement.

Variables importantes côté backend :

- `NGSILD_CLIENT_SECRET` : secret par défaut si aucun secret spécifique n'est trouvé ;
- `NGSILD_CLIENT_SECRET__<TENANT_NORMALISE>` : secret spécifique à un tenant ;
- `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DB_ENGINE`, `POSTGRES_*` ;
- `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` ;
- `AUTH_TOKEN_TTL_SECONDS` pour la durée de validité des tokens API.

## Vue d'ensemble des objets administrables

### Tenants

Un `Tenant` décrit une source NGSI-LD/Stellio.

Champs principaux :

- `slug` : identifiant court utilisé dans l'application ;
- `name` : nom lisible ;
- `api_tenant_value` : valeur envoyée dans l'en-tête tenant NGSI-LD ;
- `tenant_header` : nom de l'en-tête tenant, par défaut `NGSILD-Tenant` ;
- `auth_url` : URL OAuth utilisée pour récupérer un token ;
- `client_id` : identifiant OAuth ;
- `base_url` : URL de base NGSI-LD, terminée par `/ngsi-ld/v1/` ;
- `context_link` : lien JSON-LD envoyé dans l'en-tête `Link` ;
- `timeout_seconds` : timeout HTTP ;
- `page_limit` : taille de page utilisée lors de la pagination. L'admin limite cette valeur à 300 ;
- `client_secret_env_key` : nom explicite d'une variable d'environnement contenant le secret ;
- `is_active` : active ou désactive le tenant.

Le secret OAuth n'est pas stocké en base. Il est lu depuis l'environnement.

Ordre de résolution du secret :

1. variable indiquée dans `client_secret_env_key` ;
2. variable `NGSILD_CLIENT_SECRET__<TENANT_NORMALISE>` ;
3. variable globale `NGSILD_CLIENT_SECRET`.

### Environments

Un `Environment` représente un périmètre métier ou technique.

Il est utilisé pour :

- rattacher une `EntityTable` à un périmètre ;
- limiter l'accès des utilisateurs aux données ;
- limiter l'exposition de certaines `SqlView` et de certains `Dashboard`.

Champs principaux :

- `slug` : identifiant court ;
- `name` : nom lisible ;
- `description` ;
- `is_active`.

### Environment access groups

Un `EnvironmentAccessGroup` relie des utilisateurs Django à un ou plusieurs environnements.

Champs principaux :

- `name` ;
- `description` ;
- `is_active` ;
- `users` : utilisateurs autorisés ;
- `environments` : environnements accessibles.

Règle d'accès :

- un superutilisateur ou utilisateur `staff` est considéré comme administrateur global ;
- un utilisateur non-admin ne voit via l'API que les environnements associés à ses groupes actifs ;
- si un groupe est désactivé, ses accès ne sont plus pris en compte.

### Entity tables

Une `EntityTable` décrit un type d'entité NGSI-LD à importer dans une table SQL physique dédiée.

Champs principaux :

- `tenant` : source NGSI-LD ;
- `environment` : périmètre d'accès ;
- `entity_type` : type NGSI-LD à importer ;
- `table_name` : nom de la table SQL physique ;
- `endpoint_path` : chemin d'API NGSI-LD, par défaut `entities` ;
- `request_limit` : nombre maximal d'entités demandé lors du bouton d'import rapide ;
- `import_mode_default` : mode par défaut, `upsert` ou `full` ;
- `context_link_override` : surcharge du contexte JSON-LD du tenant ;
- `extra_query` : fragment de requête additionnel, par exemple `q=speed>50` ;
- `is_active`.

Si `table_name` est vide lors de l'enregistrement, il est généré automatiquement depuis `entity_type` avec le préfixe `ent_`.

A l'enregistrement, l'admin crée ou vérifie la table physique associée.

Colonnes système créées :

- `id` ;
- `tenant_id` ;
- `entity_type` ;
- `entity_id` ;
- `search_text` ;
- `payload_json` ;
- `created_at` ;
- `updated_at`.

Lors des imports, le backend ajoute aussi des colonnes dynamiques pour les attributs NGSI-LD simples, les relations et les géométries.

## Importer des données

### Import rapide depuis une EntityTable

Depuis la fiche d'une `EntityTable`, le bouton `Lancer import` lance un import en arrière-plan.

Ce bouton utilise :

- le mode défini dans `import_mode_default` ;
- la limite définie dans `request_limit`.

Après le clic :

1. un `ImportRun` est créé avec le statut `started` ;
2. une tâche Celery `datahub.import_entity_table` est mise en file ;
3. l'import est exécuté par le worker ;
4. le statut et les compteurs sont mis à jour.

Un seul import peut tourner en même temps pour une même `EntityTable`. Si un import est déjà en cours, l'admin affiche un avertissement.

### Modes d'import

Mode `upsert` :

- insère les nouvelles entités ;
- met à jour les entités déjà présentes ;
- ne supprime pas les anciennes lignes absentes de la source.

Mode `full` :

- insère ou met à jour les entités récupérées ;
- supprime les lignes existantes du même tenant/type absentes du résultat récupéré ;
- refuse de s'exécuter si le nombre récupéré atteint la limite configurée, pour éviter une suppression massive causée par une limite trop basse.

### Suivi d'import

Les imports sont consultables dans `Import runs`.

Colonnes visibles :

- table d'entité ;
- tenant ;
- mode ;
- statut ;
- demande d'arrêt ;
- lignes lues ;
- lignes écrites ;
- lignes supprimées ;
- date de début ;
- date de fin.

Statuts possibles :

- `started` : import en cours ;
- `success` : import terminé ;
- `failed` : import en erreur ;
- `cancelled` : import annulé.

### Annuler un import

Depuis la liste `Import runs` :

1. sélectionner un ou plusieurs imports en cours ;
2. utiliser l'action `Request stop for selected running imports`.

L'annulation n'interrompt pas brutalement le processus. Elle positionne `cancel_requested=True`, puis le worker s'arrête au prochain point de contrôle.

### Logs d'import

Les logs sont disponibles dans `Import logs`.

Ils permettent de diagnostiquer :

- le démarrage d'un import ;
- une fin réussie ;
- un verrou déjà pris ;
- une erreur HTTP ou OAuth ;
- une annulation ;
- une erreur SQL ou de table.

## Prévisualiser les données

Depuis la liste ou la fiche d'une `EntityTable`, le bouton `Voir données` ouvre une prévisualisation.

Fonctions disponibles :

- mode `Table` : affiche les colonnes utiles en masquant `search_text` et `payload_json` ;
- mode `Sources` : affiche les colonnes noyau et le payload source ;
- recherche par `entity_id` ou `search_text` ;
- pagination ;
- taille de page configurable de 1 à 1000.

La recherche utilise une condition SQL sur `entity_id` et `search_text`.

## Actions sur les Entity tables

Depuis la liste `Entity tables`, deux actions sont disponibles.

### Ensure physical table schema

Vérifie ou recrée la structure minimale de la table physique.

A utiliser si :

- la table SQL n'existe pas ;
- une migration ou restauration a supprimé des index ;
- une table a été créée manuellement.

### Drop selected physical tables

Supprime les tables physiques sélectionnées.

Attention : action destructive.

L'action est bloquée si une `SqlView` active contient le nom de la table dans sa requête SQL. Le but est d'éviter de casser une vue ou un dashboard qui dépend encore de cette table.

## SQL views

Une `SqlView` permet de créer une vue SQL ou une vue matérialisée au-dessus des tables DataHub.

Champs principaux :

- `slug` : identifiant stable utilisé par l'API ;
- `name` : nom lisible ;
- `storage_mode` : `view` ou `materialized_view` ;
- `sql_query` : requête SQL source ;
- `db_relation_name` : nom de la vue physique créée en base ;
- `environments` : environnements autorisés ;
- `is_active`.

Si `db_relation_name` est vide, il est généré automatiquement sous la forme `dh_view_<slug>`.

### Déploiement

Une `SqlView` est déployée automatiquement à l'enregistrement.

Elle peut aussi être redéployée depuis la liste avec l'action :

```text
Deploy selected SQL views
```

Le déploiement :

1. valide la requête ;
2. supprime l'ancienne vue ou vue matérialisée du même nom ;
3. crée la nouvelle relation SQL ;
4. met `last_refresh_status` à `ready`.

### Contraintes SQL

Les requêtes doivent respecter ces règles :

- commencer par `SELECT` ;
- ne pas contenir de point-virgule ;
- ne pas contenir de commentaires SQL ;
- ne pas contenir d'instructions `insert`, `update`, `delete`, `drop`, `alter`, `create`, `grant`, `revoke`, `truncate` ;
- référencer uniquement des `EntityTable.table_name` existantes ou des `SqlView.db_relation_name` déjà déployées.

Ces restrictions réduisent le risque d'exécution SQL destructive, mais une revue manuelle des requêtes reste nécessaire.

### Vues matérialisées

Pour une vue matérialisée, les données sont figées au moment de la création ou du rafraîchissement.

Après un nouvel import, utiliser l'action :

```text
Refresh selected materialized views
```

Cette action ne fonctionne que pour les vues en mode `materialized_view`.

### Prévisualiser une SqlView

Le bouton `Voir données` ouvre la même interface de prévisualisation que pour les tables :

- pagination ;
- mode `Table` ;
- mode `Sources`.

Si la vue n'a pas encore de `db_relation_name`, l'admin demande de la déployer avant prévisualisation.

## Dashboards

Un `Dashboard` décrit une interface métier exposée au frontend et alimentée par une `SqlView`.

Champs principaux :

- `slug` : identifiant utilisé dans les endpoints API ;
- `title` ;
- `description` ;
- `is_protected` ;
- `sql_view` ;
- `environments` ;
- `is_active`.

Règles d'accès :

- si `is_active=False`, le dashboard n'est pas exposé ;
- si `is_protected=True` et que des environnements sont associés, l'utilisateur doit avoir accès à au moins un de ces environnements ;
- si aucun environnement n'est associé, le dashboard protégé n'applique pas de restriction par environnement dans le code actuel ;
- les admins globaux ont accès à tous les environnements.

Endpoints alimentés par les dashboards :

- `GET /api/v1/dashboards/` ;
- `GET /api/v1/dashboards/<slug>/` ;
- `GET /api/v1/dashboards/<slug>/data/` ;
- `GET /api/v1/dashboards/<slug>/kpis/` ;
- `GET /api/v1/dashboards/<slug>/joined/` ;
- `GET /api/v1/dashboards/<slug>/map/`.

Le dashboard lit principalement le nombre de lignes et les données issues de la `SqlView` liée.

## Utilisateurs et droits

Les utilisateurs Django standards sont gérés dans la section `Authentication and Authorization` de l'admin.

Pour donner accès à l'admin :

1. ouvrir la fiche utilisateur ;
2. cocher `Staff status` ;
3. attribuer les permissions nécessaires ou cocher `Superuser status`.

Pour donner accès aux données frontend/API :

1. créer ou ouvrir un `Environment access group` ;
2. ajouter l'utilisateur dans `users` ;
3. ajouter les environnements autorisés dans `environments` ;
4. vérifier que le groupe est actif.

Un utilisateur peut se connecter côté frontend via `/connexion`. L'API retourne ses environnements via :

```text
GET /api/v1/accounts/me/
```

## Workflow recommandé

Pour créer un nouveau flux de données :

1. Créer ou vérifier le `Tenant`.
2. Créer ou vérifier l'`Environment`.
3. Créer une `EntityTable` pour le type NGSI-LD.
4. Enregistrer l'`EntityTable` pour créer la table physique.
5. Lancer un import.
6. Vérifier `Import runs` et `Import logs`.
7. Ouvrir `Voir données` pour contrôler les lignes importées.
8. Créer une `SqlView` si un dashboard ou une API agrégée doit consommer les données.
9. Prévisualiser la `SqlView`.
10. Créer ou mettre à jour le `Dashboard`.
11. Associer les bons environnements et groupes d'accès.
12. Tester avec un utilisateur non-admin.

## Commande CLI équivalente aux imports

Un import peut aussi être lancé sans passer par l'admin :

```powershell
cd backend
python manage.py import_entity_type --entity-type <TYPE> --tenant <TENANT_SLUG> --mode upsert --limit 500
```

Pour lancer via Celery :

```powershell
python manage.py import_entity_type --entity-type <TYPE> --tenant <TENANT_SLUG> --mode upsert --limit 500 --async
```

## Dépannage

### L'import reste en statut `started`

Vérifier :

- que le worker Celery tourne ;
- que le broker Redis est accessible ;
- les logs du conteneur ou processus Celery ;
- les entrées `Import logs`.

### Erreur `Missing environment variable`

Le secret OAuth ou une configuration NGSI-LD manque.

Vérifier :

- `client_secret_env_key` dans le `Tenant` ;
- `NGSILD_CLIENT_SECRET__<TENANT_NORMALISE>` ;
- `NGSILD_CLIENT_SECRET`.

### Erreur 401 OAuth ou NGSI-LD

Vérifier :

- `auth_url` ;
- `client_id` ;
- secret OAuth ;
- `api_tenant_value` ;
- `tenant_header`.

### Une SqlView refuse de se déployer

Causes fréquentes :

- la requête ne commence pas par `SELECT` ;
- une relation `FROM` ou `JOIN` ne correspond pas à une table DataHub ou vue déployée ;
- la requête contient un token interdit ;
- la requête dépasse le timeout configuré par `DATAHUB_SQL_VIEW_STATEMENT_TIMEOUT_MS`.

### Un utilisateur ne voit pas un dashboard ou des données

Vérifier :

- que l'utilisateur est dans un `EnvironmentAccessGroup` actif ;
- que le groupe contient le bon environnement ;
- que l'`EntityTable`, la `SqlView` ou le `Dashboard` sont actifs ;
- que le dashboard ou la vue est bien associé au même environnement.

### Les données géographiques n'apparaissent pas sur la carte

Les endpoints cherchent une géométrie dans certaines colonnes comme :

- `geometry` ;
- `localisation_geojson` ;
- `c_localisation_geojson` ;
- `here_payload_json` selon l'endpoint.

Vérifier que la `SqlView` expose bien une colonne GeoJSON exploitable.

## Points de vigilance

- Le mode `full` peut supprimer des lignes. Utiliser une limite suffisamment haute et tester d'abord sur un périmètre réduit.
- Les tables physiques sont dynamiques : les attributs NGSI-LD peuvent créer de nouvelles colonnes.
- Les vues SQL peuvent alimenter directement des dashboards. Toute modification de requête doit être testée.
- Les vues matérialisées doivent être rafraîchies après les imports.
- La suppression d'une table physique est destructive.
- Certains libellés de templates admin semblent encodés de manière incorrecte dans le dépôt (`DonnÃ©es`, `PrÃ©cÃ©dent`). Si l'interface affiche ces caractères, corriger l'encodage des templates concernés.

