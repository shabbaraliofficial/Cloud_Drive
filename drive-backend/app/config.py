from __future__ import annotations

import logging
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"
REPO_ENV_PATH = BASE_DIR.parent / ".env"
DEFAULT_ALLOWED_MIME_TYPES = (
    "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,"
    "video/quicktime,application/pdf,text/plain,application/zip"
)
DEFAULT_CORS_ORIGINS = "http://localhost:5173,https://your-frontend-domain.com"


def _clean_text(value: str | None, default: str = "") -> str:
    if value is None:
        return default
    cleaned = str(value).strip().strip('"').strip("'").strip()
    return cleaned or default


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _clean_mongo_url(value: str | None) -> str | None:
    cleaned = _clean_text(value)
    if cleaned.upper().startswith("MONGO_URL="):
        cleaned = cleaned.split("=", 1)[1].strip()
    return cleaned or None


class Settings(BaseSettings):
    APP_NAME: str = "Cloud Drive Backend"
    APP_ENV: str = "development"
    APP_DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 10000

    MONGO_URL: str | None = None
    MONGODB_DB_NAME: str = ""

    JWT_SECRET: str = ""
    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    SESSION_SECRET_KEY: str = ""

    OTP_EXPIRY_MINUTES: int = 10
    OTP_LENGTH: int = 6

    DEFAULT_STORAGE_QUOTA_BYTES: int = 10737418240
    MAX_FILE_SIZE_MB: int = 50
    ALLOWED_MIME_TYPES: str = DEFAULT_ALLOWED_MIME_TYPES

    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_SESSION_TOKEN: str = ""
    AWS_PROFILE: str = ""
    AWS_REGION: str = ""
    AWS_BUCKET_NAME: str = ""
    AWS_S3_BUCKET: str = ""
    AWS_S3_ENDPOINT_URL: str = ""
    AWS_S3_PUBLIC_READ: bool = True

    MAIL_USERNAME: str = ""
    MAIL_PASSWORD: str = ""
    MAIL_FROM: str = ""
    MAIL_PORT: int = 587
    MAIL_SERVER: str = "smtp-relay.brevo.com"

    CORS_ORIGINS: str = DEFAULT_CORS_ORIGINS

    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    FRONTEND_URL: str = "http://localhost:5173"
    GOOGLE_REDIRECT_URI: str = ""

    model_config = SettingsConfigDict(
        env_file=(ENV_PATH, REPO_ENV_PATH),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )


settings = Settings()

APP_NAME = _clean_text(settings.APP_NAME, "Cloud Drive Backend")
APP_ENV = _clean_text(settings.APP_ENV, "development")
APP_DEBUG = bool(settings.APP_DEBUG)
HOST = _clean_text(settings.HOST, "0.0.0.0")
PORT = int(settings.PORT)

MONGO_URL = _clean_mongo_url(settings.MONGO_URL)
MONGODB_DB_NAME = _clean_text(settings.MONGODB_DB_NAME)

JWT_SECRET = _clean_text(settings.JWT_SECRET) or _clean_text(settings.JWT_SECRET_KEY)
JWT_SECRET_KEY = _clean_text(settings.JWT_SECRET_KEY) or _clean_text(settings.JWT_SECRET)
JWT_ALGORITHM = _clean_text(settings.JWT_ALGORITHM, "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(settings.ACCESS_TOKEN_EXPIRE_MINUTES)
REFRESH_TOKEN_EXPIRE_DAYS = int(settings.REFRESH_TOKEN_EXPIRE_DAYS)
SESSION_SECRET_KEY = (
    _clean_text(settings.SESSION_SECRET_KEY)
    or JWT_SECRET_KEY
)

OTP_EXPIRY_MINUTES = int(settings.OTP_EXPIRY_MINUTES)
OTP_LENGTH = int(settings.OTP_LENGTH)

DEFAULT_STORAGE_QUOTA_BYTES = int(settings.DEFAULT_STORAGE_QUOTA_BYTES)
MAX_FILE_SIZE_MB = int(settings.MAX_FILE_SIZE_MB)
ALLOWED_MIME_TYPES = _split_csv(
    _clean_text(settings.ALLOWED_MIME_TYPES, DEFAULT_ALLOWED_MIME_TYPES)
)

AWS_ACCESS_KEY_ID = _clean_text(settings.AWS_ACCESS_KEY_ID)
AWS_SECRET_ACCESS_KEY = _clean_text(settings.AWS_SECRET_ACCESS_KEY)
AWS_SESSION_TOKEN = _clean_text(settings.AWS_SESSION_TOKEN)
AWS_PROFILE = _clean_text(settings.AWS_PROFILE)
AWS_REGION = _clean_text(settings.AWS_REGION)
AWS_BUCKET_NAME = _clean_text(settings.AWS_BUCKET_NAME) or _clean_text(settings.AWS_S3_BUCKET)
AWS_S3_BUCKET = _clean_text(settings.AWS_S3_BUCKET) or AWS_BUCKET_NAME
AWS_S3_ENDPOINT_URL = _clean_text(settings.AWS_S3_ENDPOINT_URL)
AWS_S3_PUBLIC_READ = bool(settings.AWS_S3_PUBLIC_READ)

MAIL_USERNAME = _clean_text(settings.MAIL_USERNAME)
MAIL_PASSWORD = _clean_text(settings.MAIL_PASSWORD)
MAIL_FROM = _clean_text(settings.MAIL_FROM)
MAIL_PORT = int(settings.MAIL_PORT)
MAIL_SERVER = _clean_text(settings.MAIL_SERVER, "smtp-relay.brevo.com")
MAIL_STARTTLS = True
MAIL_SSL_TLS = False
USE_CREDENTIALS = True
VALIDATE_CERTS = True

# Backward-compatible aliases for existing imports while MAIL_* remains canonical.
SMTP_HOST = MAIL_SERVER
SMTP_PORT = MAIL_PORT
SMTP_USER = MAIL_USERNAME
SMTP_PASSWORD = MAIL_PASSWORD
SMTP_FROM = MAIL_FROM
EMAIL_USER = MAIL_USERNAME
EMAIL_PASSWORD = MAIL_PASSWORD

CORS_ORIGINS = _split_csv(_clean_text(settings.CORS_ORIGINS, DEFAULT_CORS_ORIGINS))

RAZORPAY_KEY_ID = _clean_text(settings.RAZORPAY_KEY_ID)
RAZORPAY_KEY_SECRET = _clean_text(settings.RAZORPAY_KEY_SECRET)
FRONTEND_URL = _clean_text(settings.FRONTEND_URL, "http://localhost:5173")
GOOGLE_REDIRECT_URI = _clean_text(settings.GOOGLE_REDIRECT_URI)

print(f"[config] MONGO_URL loaded={bool(MONGO_URL)}")
logger.info("Render host/port configured: %s:%s", HOST, PORT)
logger.info("Mongo URL configured: %s", bool(MONGO_URL))
logger.info("Mongo DB name configured: %s", bool(MONGODB_DB_NAME))
logger.info("JWT secret configured: %s", bool(JWT_SECRET_KEY))
logger.info("AWS bucket configured: %s", bool(AWS_BUCKET_NAME))
logger.info("AWS region configured: %s", bool(AWS_REGION))
logger.info("Mail server configured: %s", bool(MAIL_SERVER))
logger.info("Mail sender configured: %s", bool(MAIL_FROM))
logger.info("Razorpay configured: %s", bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET))
