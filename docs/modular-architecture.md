# Modular architecture and team split

## Target structure
- `frontend/` (current React/Vite app)
- `backend/` (new Django app)

Current state in this repository:
- Frontend lives in `frontend/`
- Backend lives in `backend/`
- API contracts are wired in frontend pages through `frontend/src/api/client.ts`

## Ownership by module
- Team A: `apps/accounts`
- Team B: `apps/projects`
- Team C: `apps/dashboards`
- Team D: `apps/geodata`
- Team E: shared concerns in `apps/core` and `config/settings`

## Contracts between frontend and backend
- `GET /api/v1/projects/`
- `GET /api/v1/projects/{slug}/`
- `GET /api/v1/dashboards/`
- `GET /api/v1/dashboards/{slug}/data/`
- `GET /api/v1/geodata/segments/`
- `GET /api/v1/core/health/`
- `GET /api/v1/accounts/me/` (auth required)

NGSI-LD integration is centralized in backend `apps/ngsild` and consumed by dashboard data endpoints.

## Remaining production steps
1. Add CI pipelines split by module ownership.
2. Add deployment manifests for frontend and backend as separate services.
3. Add rate limiting and token rotation policy on auth endpoints.
