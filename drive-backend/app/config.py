from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"
REPO_ENV_PATH = BASE_DIR.parent / ".env"
BACKEND_ENV_LOADED = load_dotenv(ENV_PATH, override=False)
REPO_ENV_LOADED = load_dotenv(REPO_ENV_PATH, override=False)


def _getenv(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value is None:
            continue
        cleaned = str(value).strip().strip('"').strip("'").strip()
        if cleaned:
            return cleaned
    return default


def _getenv_bool(name: str, default: bool = False) -> bool:
    value = str(os.getenv(name, str(default))).strip().lower()
    return value in {"1", "true", "yes", "on"}


APP_NAME = os.getenv("APP_NAME", "Cloud Drive Backend")
APP_ENV = os.getenv("APP_ENV", "development")
APP_DEBUG = _getenv_bool("APP_DEBUG", False)
HOST = _getenv("HOST", default="0.0.0.0")
PORT = int(_getenv("PORT", default="10000"))

MONGO_URL = _getenv("MONGO_URL", "MONGODB_URL")
MONGODB_URL = MONGO_URL
MONGODB_DB_NAME = _getenv("MONGODB_DB_NAME")

JWT_SECRET = _getenv("JWT_SECRET", "JWT_SECRET_KEY")
JWT_SECRET_KEY = JWT_SECRET
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
SESSION_SECRET_KEY = _getenv("SESSION_SECRET_KEY", "SESSION_SECRET", "JWT_SECRET", "JWT_SECRET_KEY")

OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", "10"))
OTP_LENGTH = int(os.getenv("OTP_LENGTH", "6"))

DEFAULT_STORAGE_QUOTA_BYTES = int(os.getenv("DEFAULT_STORAGE_QUOTA_BYTES", "10737418240"))
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
ALLOWED_MIME_TYPES = [
    item.strip()
    for item in os.getenv(
        "ALLOWED_MIME_TYPES",
        "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,application/zip",
    ).split(",")
    if item.strip()
]

AWS_ACCESS_KEY_ID = _getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = _getenv("AWS_SECRET_ACCESS_KEY")
AWS_SESSION_TOKEN = _getenv("AWS_SESSION_TOKEN")
AWS_PROFILE = _getenv("AWS_PROFILE")
AWS_REGION = _getenv("AWS_REGION")
AWS_BUCKET_NAME = _getenv("AWS_BUCKET_NAME", "AWS_S3_BUCKET")
AWS_S3_BUCKET = AWS_BUCKET_NAME
AWS_S3_ENDPOINT_URL = _getenv("AWS_S3_ENDPOINT_URL")
AWS_S3_PUBLIC_READ = _getenv_bool("AWS_S3_PUBLIC_READ", True)

SMTP_HOST = _getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = _getenv("SMTP_USER")
SMTP_PASSWORD = _getenv("SMTP_PASSWORD", "SMTP_PASS")
SMTP_FROM = _getenv("SMTP_FROM", "SMTP_USER")

EMAIL_USER = _getenv("EMAIL_USER", "SMTP_USER")
EMAIL_PASSWORD = _getenv("EMAIL_PASSWORD", "SMTP_PASSWORD", "SMTP_PASS")

CORS_ORIGINS = [
    item.strip()
    for item in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,https://your-frontend-domain.com",
    ).split(",")
    if item.strip()
]

RAZORPAY_KEY_ID = _getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = _getenv("RAZORPAY_KEY_SECRET")
FRONTEND_URL = _getenv("FRONTEND_URL", default="http://localhost:5173")
GOOGLE_REDIRECT_URI = _getenv("GOOGLE_REDIRECT_URI")

if BACKEND_ENV_LOADED:
    logger.info("Loaded backend environment from %s", ENV_PATH)
elif REPO_ENV_LOADED:
    logger.info("Loaded repository environment from %s", REPO_ENV_PATH)
else:
    logger.info("No .env file found. Using environment variables from the host instead.")

logger.info("Render host/port configured: %s:%s", HOST, PORT)
logger.info("Mongo URL configured: %s", bool(MONGODB_URL))
logger.info("Mongo DB name configured: %s", bool(MONGODB_DB_NAME))
logger.info("JWT secret configured: %s", bool(JWT_SECRET_KEY))
logger.info("AWS bucket configured: %s", bool(AWS_BUCKET_NAME))
logger.info("AWS region configured: %s", bool(AWS_REGION))
logger.info("Razorpay configured: %s", bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET))
