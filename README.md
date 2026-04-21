# Vitrine Monorepo

Repository layout:

- `frontend/`: React + Vite application
- `backend/`: Django + DRF API
- `docs/`: architecture and team split notes

## Run backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py loaddata apps/dashboards/fixtures/initial_dashboards.json
python manage.py loaddata apps/projects/fixtures/initial_projects.json
python manage.py createsuperuser
python manage.py runserver
```

Backend API base URL: `http://127.0.0.1:8000/api/v1/`

### Optional data stack (phase 1)
Backend now supports:
- PostgreSQL + PostGIS (`DB_ENGINE=postgis`)
- Redis cache (`USE_REDIS_CACHE=true`)
- Celery worker (`celery -A config worker -l info`)
- Local services bootstrap: `docker compose -f backend/docker-compose.stack.yml up -d`

## Run frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL: `http://localhost:5173`

The frontend consumes the backend API through:

- `GET /api/v1/projects/`
- `GET /api/v1/projects/{slug}/`
- `GET /api/v1/dashboards/`
- `GET /api/v1/dashboards/{slug}/`
- `GET /api/v1/dashboards/{slug}/data/`
- `GET /api/v1/dashboards/{slug}/map/`
- `GET /api/v1/dashboards/{slug}/kpis/`
- `GET /api/v1/dashboards/{slug}/timeseries/`
- `GET /api/v1/geodata/segments/`

Authentication now uses Django token endpoints:

- `POST /api/v1/accounts/login/`
- `POST /api/v1/accounts/logout/`
- `GET /api/v1/accounts/me/`

For local dev, Vite proxies `/api` to `http://127.0.0.1:8000`.

NGSI-LD access is centralized in backend (`apps/ngsild`) and configured in `backend/.env.example`.
Per-dashboard tenant/source overrides are managed in Django admin via `Dashboard NGSI-LD sources`.
