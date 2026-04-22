# Backend Django

This backend is split into domain apps to make parallel team work easier.

## Target stack (validated phase 1)
- PostgreSQL + PostGIS (primary data store for scale and spatial queries)
- Redis (cache + Celery broker/result backend)
- Celery (async ingestion/sync workers)

Quick local bootstrap:
- `docker compose -f docker-compose.stack.yml up -d`
- set `DB_ENGINE=postgis` and `USE_REDIS_CACHE=true` in `backend/.env`
- run `python manage.py migrate`

Full stack bootstrap (from repo root):
- `docker compose up -d --build`
- app exposed on `http://<VM_PUBLIC_IP>/` (frontend + `/api` reverse-proxy)

## Modules
- `apps/core`: technical endpoints (`/health`)
- `apps/accounts`: user/account endpoints
- `apps/projects`: project catalog and media
- `apps/dashboards`: tenant + dashboard metadata
- `apps/geodata`: road segment geodata and sync command

## Run locally
1. Create virtual env and install dependencies:
   - `python -m venv .venv`
   - `.\.venv\Scripts\activate`
   - `pip install -r requirements.txt`
2. Configure env:
   - copy `.env.example` to `.env`
   - `.env` (and optional `.env.local`) are loaded automatically at startup
3. Run migrations and server:
   - `python manage.py migrate`
   - `python manage.py loaddata apps/dashboards/fixtures/initial_dashboards.json`
   - `python manage.py loaddata apps/projects/fixtures/initial_projects.json`
   - `python manage.py createsuperuser`
   - `python manage.py runserver`

API base url: `http://127.0.0.1:8000/api/v1/`

Infra health endpoint:
- `GET /api/v1/core/health/` (database/cache/celery status)

## Auth endpoints
- `POST /api/v1/accounts/login/`
- `POST /api/v1/accounts/logout/`
- `GET /api/v1/accounts/me/`

## Dashboard data endpoint (NGSI-LD)
- `GET /api/v1/dashboards/{slug}/data/`
- `GET /api/v1/dashboards/{slug}/map/`
- `GET /api/v1/dashboards/{slug}/kpis/`
- `GET /api/v1/dashboards/{slug}/timeseries/`

Query params (marts):
- `map`: `type`, `tenant`, `join_key`, `page`, `page_size`
- `kpis`: `type`, `tenant`
- `timeseries`: `type`, `tenant`, `days`

Marts responses are cached using Django cache (Redis when enabled).

All NGSI-LD credentials and provider settings are centralized in `backend/.env.example` under `NGSILD_*`.

## Pilot dashboards
- `floatingcardata`
- `ceremap3d`

## Tenant model (collaborative mode)
- A `Tenant` now structures dashboards (`Tenant -> Dashboards`).
- No access restriction is applied per user: all authenticated developers can see all tenants/dashboards.
- Team workflow relies on functional ownership (each dev works on its own tenant/dashboard scope) without hard RBAC limits.

## Multi-tenant per dashboard (Django Admin)
Use `Dashboard NGSI-LD sources` in admin to configure tenant and source settings per dashboard:
- target dashboard slug
- one or multiple entity types (inline `Dashboard NGSI-LD entity types`)
- `tenant` / `tenant_header`
- optional overrides (`auth_url`, `base_url`, `client_id`, `context_link`)
- request and cache tuning (`request_limit`, `cache_ttl_seconds`)

`client_secret` is intentionally not editable in admin. It is resolved from environment variables:
- default: `NGSILD_CLIENT_SECRET`
- tenant-specific: `NGSILD_CLIENT_SECRET__<TENANT_NORMALIZED>`

`auth_url` and `client_id` can also be tenant-scoped from environment variables:
- `NGSILD_AUTH_URL__<TENANT_NORMALIZED>`
- `NGSILD_CLIENT_ID__<TENANT_NORMALIZED>`

## Sync orchestration (step 3)
- Source-level scheduling fields are available in `Dashboard NGSI-LD sources`:
  - `is_sync_enabled`
  - `sync_mode`
  - `sync_interval_minutes`
  - `last_synced_at`
- Admin actions:
  - enqueue sync jobs from selected sources
  - run selected pending sync jobs
- Management commands:
  - `python manage.py schedule_ngsild_sync`
  - `python manage.py run_ngsild_sync_jobs --limit 20`
- With Celery beat enabled, due jobs are enqueued and pending jobs processed automatically.

## Ingestion v1 (step 4)
- Normalized storage table: `Dashboard NGSI-LD normalized entities`
- Upsert strategy:
  - `incremental`: upsert by (`source`, `entity_type`, `entity_id`)
  - `full`: replace dataset for each synced `entity_type`
- Normalized analytical fields:
  - `dashboard_slug`, `tenant`, `join_key`, `scope`, `ngsi_updated_at`
  - indexes for (`tenant`, `entity_type`) and (`entity_type`, `join_key`)
- Manual command:
  - `python manage.py sync_ngsild_source --dashboard floatingcardata --mode incremental`
  - `python manage.py sync_ngsild_source --dashboard ceremap3d --mode full`
