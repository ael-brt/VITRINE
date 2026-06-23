from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parents[2]

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "unsafe-dev-key")
DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = [h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",") if h.strip()]
CSRF_TRUSTED_ORIGINS = [
    value.strip()
    for value in os.getenv(
        "CSRF_TRUSTED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if value.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework.authtoken",
    "apps.core",
    "apps.accounts",
    "apps.datahub",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DB_ENGINE = os.getenv("DB_ENGINE", "sqlite").strip().lower()
if DB_ENGINE in {"postgres", "postgis"}:
    DATABASES = {
        "default": {
            # Use PostgreSQL engine locally to avoid requiring GDAL on dev machines.
            # PostGIS capabilities can be enabled later in containerized environments.
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("POSTGRES_DB", "vitrine"),
            "USER": os.getenv("POSTGRES_USER", "vitrine"),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD", "vitrine"),
            "HOST": os.getenv("POSTGRES_HOST", "127.0.0.1"),
            "PORT": os.getenv("POSTGRES_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Europe/Paris"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_STORAGE_ROOT = os.getenv("MEDIA_STORAGE_ROOT", str(BASE_DIR / "media_storage"))
MEDIA_INTERNAL_URL_PREFIX = os.getenv("MEDIA_INTERNAL_URL_PREFIX", "/protected-media/")
MEDIA_UPLOAD_MAX_BYTES = int(os.getenv("MEDIA_UPLOAD_MAX_BYTES", "104857600"))
CEREMAP3D_IMAGE_ROOT = os.getenv("CEREMAP3D_IMAGE_ROOT", str(Path(MEDIA_STORAGE_ROOT) / "ceremap3d-images"))
CEREMAP3D_IMAGE_INTERNAL_URL_PREFIX = os.getenv("CEREMAP3D_IMAGE_INTERNAL_URL_PREFIX", "")
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.ExpiringTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/minute",
        "user": "600/minute",
        "login": "12/minute",
    },
}

CORS_ALLOWED_ORIGINS = [
    value.strip()
    for value in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if value.strip()
]
CORS_ALLOW_CREDENTIALS = True

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/1")
USE_REDIS_CACHE = os.getenv("USE_REDIS_CACHE", "false").lower() == "true"

if USE_REDIS_CACHE:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
            },
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        }
    }

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_TASK_DEFAULT_QUEUE = os.getenv("CELERY_TASK_DEFAULT_QUEUE", "default")
CELERY_TASK_TRACK_STARTED = True
_celery_soft_limit = int(os.getenv("CELERY_TASK_SOFT_TIME_LIMIT", "0"))
_celery_hard_limit = int(os.getenv("CELERY_TASK_TIME_LIMIT", "0"))
if _celery_soft_limit > 0:
    CELERY_TASK_SOFT_TIME_LIMIT = _celery_soft_limit
if _celery_hard_limit > 0:
    CELERY_TASK_TIME_LIMIT = _celery_hard_limit

CELERY_BEAT_SCHEDULE = {}

AUTH_TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "86400"))
DATAHUB_SQL_VIEW_STATEMENT_TIMEOUT_MS = int(os.getenv("DATAHUB_SQL_VIEW_STATEMENT_TIMEOUT_MS", "5000"))
AUTH_TOKEN_COOKIE_NAME = os.getenv("AUTH_TOKEN_COOKIE_NAME", "vitrine_auth_token")
AUTH_TOKEN_COOKIE_PATH = os.getenv("AUTH_TOKEN_COOKIE_PATH", "/")
AUTH_TOKEN_COOKIE_SECURE = os.getenv("AUTH_TOKEN_COOKIE_SECURE", "false" if DEBUG else "true").lower() == "true"
AUTH_TOKEN_COOKIE_HTTPONLY = os.getenv("AUTH_TOKEN_COOKIE_HTTPONLY", "true").lower() == "true"
AUTH_TOKEN_COOKIE_SAMESITE = os.getenv("AUTH_TOKEN_COOKIE_SAMESITE", "Lax")
