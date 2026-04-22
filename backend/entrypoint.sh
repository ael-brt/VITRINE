#!/bin/sh
set -e

echo "Waiting for database..."
python - <<'PY'
import os
import time
import psycopg

host = os.getenv("POSTGRES_HOST", "postgres")
port = int(os.getenv("POSTGRES_PORT", "5432"))
dbname = os.getenv("POSTGRES_DB", "vitrine")
user = os.getenv("POSTGRES_USER", "vitrine")
password = os.getenv("POSTGRES_PASSWORD", "vitrine")

for _ in range(60):
    try:
        with psycopg.connect(
            host=host,
            port=port,
            dbname=dbname,
            user=user,
            password=password,
            connect_timeout=3,
        ) as _conn:
            break
    except Exception:
        time.sleep(2)
else:
    raise SystemExit("Database is not reachable.")
PY

echo "Running migrations..."
python manage.py migrate --noinput

echo "Collecting static files..."
python manage.py collectstatic --noinput

if [ "${INIT_FIXTURES:-false}" = "true" ]; then
  echo "Loading fixtures..."
  python manage.py loaddata apps/dashboards/fixtures/initial_dashboards.json || true
  python manage.py loaddata apps/projects/fixtures/initial_projects.json || true
fi

echo "Starting API..."
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers "${GUNICORN_WORKERS:-3}" --timeout "${GUNICORN_TIMEOUT:-120}"
