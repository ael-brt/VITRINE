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

## Data Hub ingestion
- Entity ingestion is now handled by `apps/datahub`.
- One entity type is mapped to one physical table.
- Imports can run in `upsert` or `full` mode from Django admin or command:
  - `python manage.py import_entity_type --entity-type <TYPE> --tenant <TENANT_SLUG> --mode upsert`
