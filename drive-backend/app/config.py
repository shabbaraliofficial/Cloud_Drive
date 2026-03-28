from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"
_env_loaded = load_dotenv(ENV_PATH, override=False)

APP_NAME = os.getenv("APP_NAME", "Cloud Drive Backend")
APP_ENV = os.getenv("APP_ENV", "development")
APP_DEBUG = os.getenv("APP_DEBUG", "false").lower() == "true"

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "cloud_drive_db")

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change_me")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

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

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN", "")
AWS_PROFILE = os.getenv("AWS_PROFILE", "")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
AWS_BUCKET_NAME = os.getenv("AWS_BUCKET_NAME", "")
AWS_S3_BUCKET = AWS_BUCKET_NAME or os.getenv("AWS_S3_BUCKET", "")
AWS_S3_ENDPOINT_URL = os.getenv("AWS_S3_ENDPOINT_URL", "")
AWS_S3_PUBLIC_READ = os.getenv("AWS_S3_PUBLIC_READ", "false").lower() == "true"

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")

EMAIL_USER = os.getenv("EMAIL_USER", "")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "")

CORS_ORIGINS = [
    item.strip()
    for item in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if item.strip()
]

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")

if _env_loaded:
    logger.info("Loaded environment from %s", ENV_PATH)
else:
    logger.warning("No .env file found at %s", ENV_PATH)
logger.info(
    "AWS_ACCESS_KEY_ID: %s",
    f"{AWS_ACCESS_KEY_ID[:4]}..." if AWS_ACCESS_KEY_ID else "<missing>",
)
logger.info("AWS_BUCKET_NAME: %s", AWS_BUCKET_NAME or "<missing>")
logger.info("AWS_PROFILE: %s", AWS_PROFILE or "<not set>")
logger.info("AWS_S3_PUBLIC_READ: %s", AWS_S3_PUBLIC_READ)

logger.info(
    "RAZORPAY_KEY_ID: %s",
    f"{RAZORPAY_KEY_ID[:8]}..." if RAZORPAY_KEY_ID else "<missing>",
)
logger.info("RAZORPAY_KEY_SECRET set: %s", bool(RAZORPAY_KEY_SECRET))
