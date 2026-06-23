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
- `apps/datahub`: tenants, environments, entity ingestion, SQL views

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
   - configure tenants/environments/entity tables in Django admin
   - `python manage.py createsuperuser`
   - `python manage.py runserver`

API base url: `http://127.0.0.1:8000/api/v1/`

Infra health endpoint:
- `GET /api/v1/core/health/` (database/cache/celery status)

## Auth endpoints
- `POST /api/v1/accounts/login/`
- `POST /api/v1/accounts/logout/`
- `GET /api/v1/accounts/me/`

## Media storage service
- Media files are stored on disk under `MEDIA_STORAGE_ROOT`.
- Access is brokered by Django through `/api/v1/datahub/media-assets/`.
- For production, prefer protected Nginx serving with:
  - `MEDIA_STORAGE_ROOT=/srv/vitrine-media`
  - `MEDIA_INTERNAL_URL_PREFIX=/protected-media/`
- For local dev, set `MEDIA_INTERNAL_URL_PREFIX=` to let Django stream files directly.

Main endpoints:
- `GET /api/v1/datahub/media-assets/?dashboard_slug=<slug>&entity_type=<type>&entity_id=<id>`
- `POST /api/v1/datahub/media-assets/` with multipart field `file`
- `GET /api/v1/datahub/media-assets/<id>/`
- `GET /api/v1/datahub/media-assets/<id>/file/`

### Ceremap3D referenced images
- Use this mode when panel rows already contain a relative image path (`first_image_path`, `imgpath`, etc.).
- Drop the whole image tree under `CEREMAP3D_IMAGE_ROOT`.
- Backend resolves the referenced path safely and serves the file through:
- `GET /api/v1/datahub/ceremap3d/panel-image/?entity_id=<urn:...>`
- `GET /api/v1/datahub/ceremap3d/category-symbol/?category=<A-DANGER>`
- Optional direct debug path:
  - `GET /api/v1/datahub/ceremap3d/panel-image/?path=<relative/path.jpg>`
- For local dev, set:
  - `CEREMAP3D_IMAGE_INTERNAL_URL_PREFIX=`
- For protected Nginx serving, point it to a dedicated internal location mapped to `CEREMAP3D_IMAGE_ROOT`.

Suggested Nginx block:
```nginx
location /protected-media/ {
    internal;
    alias /srv/vitrine-media/;
}
```

## Data Hub ingestion
- Entity ingestion is now handled by `apps/datahub`.
- One entity type is mapped to one physical table.
- API connection settings are configured per tenant and per entity table in Django admin.
- `client_secret` stays in environment variables (per-tenant key supported):
  - `NGSILD_CLIENT_SECRET__<TENANT_VALUE_NORMALIZED>`
  - or explicit env var named in `Tenant.client_secret_env_key`
- Imports can run in `upsert` or `full` mode from Django admin or command:
  - `python manage.py import_entity_type --entity-type <TYPE> --tenant <TENANT_SLUG> --mode upsert`
