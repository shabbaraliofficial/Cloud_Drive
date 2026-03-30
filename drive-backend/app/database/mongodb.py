from __future__ import annotations

from datetime import datetime
import logging
import os
from typing import Any

from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import PyMongoError

from app.core import config
from app.utils.password_handler import hash_password
from app.utils.plans import build_plan_update

logger = logging.getLogger(__name__)

client: AsyncIOMotorClient | None = None
database: AsyncIOMotorDatabase | None = None
database_error: str | None = "MongoDB is not connected"


def _resolve_database_name(resolved_client: AsyncIOMotorClient) -> str:
    if config.MONGODB_DB_NAME:
        return config.MONGODB_DB_NAME

    default_database = resolved_client.get_default_database(default=None)
    if default_database is not None:
        return default_database.name

    return "cloud_drive_db"


async def connect_to_mongo() -> None:
    global client, database, database_error

    MONGO_URL = config.MONGO_URL

    if not MONGO_URL:
        database_error = "MongoDB URL is not configured. Set MONGO_URL on the host."
        client = None
        database = None
        logger.warning(database_error)
        return

    if not MONGO_URL.startswith(("mongodb://", "mongodb+srv://")):
        database_error = "MongoDB URL must be a full MongoDB URI. Set MONGO_URL to a value like mongodb+srv://..."
        client = None
        database = None
        logger.warning(database_error)
        return

    try:
        client = AsyncIOMotorClient(MONGO_URL)
        database = client[_resolve_database_name(client)]
        await database.command("ping")
        database_error = None
        logger.info("MongoDB connected successfully: db=%s", database.name)
        await ensure_indexes()
        await ensure_admin_user()
    except Exception as exc:
        database_error = str(exc)
        logger.exception("Failed to connect to MongoDB")
        if client is not None:
            client.close()
        client = None
        database = None


async def close_mongo_connection() -> None:
    global client, database, database_error
    if client is not None:
        client.close()
    client = None
    database = None
    database_error = "MongoDB connection closed"


def get_database() -> AsyncIOMotorDatabase:
    if database is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=database_error or "MongoDB is not connected",
        )
    return database


async def test_mongo_connection() -> dict[str, Any]:
    global database_error

    if database is None:
        return {"ok": 0.0, "error": database_error or "MongoDB is not connected"}

    try:
        result = await database.command("ping")
        return {
            "ok": float(result.get("ok", 1.0)),
            "database": database.name,
        }
    except Exception as exc:
        database_error = str(exc)
        logger.exception("MongoDB ping failed")
        return {"ok": 0.0, "error": database_error}


async def ensure_indexes() -> None:
    db = get_database()
    await db.users.update_many(
        {"$or": [{"role": {"$exists": False}}, {"role": None}, {"role": ""}]},
        {"$set": {"role": "user"}},
    )
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.users.create_index([("username", ASCENDING)], unique=True)
    await db.users.create_index([("mobile_number", ASCENDING)], unique=True)
    await db.users.create_index([("role", ASCENDING)])
    await db.otp_codes.create_index([("email", ASCENDING), ("purpose", ASCENDING), ("created_at", DESCENDING)])
    await db.files.create_index([("owner_id", ASCENDING), ("is_deleted", ASCENDING), ("updated_at", DESCENDING)])
    await db.folders.create_index([("owner_id", ASCENDING), ("is_deleted", ASCENDING), ("updated_at", DESCENDING)])
    await db.files.create_index([("shared_with", ASCENDING), ("share_expiry", ASCENDING)])
    await db.folders.create_index([("shared_with", ASCENDING), ("share_expiry", ASCENDING)])
    await db.shared_files.create_index([("shared_with_user_id", ASCENDING), ("created_at", DESCENDING)])
    await db.shares.create_index([("share_token", ASCENDING)], unique=True)
    await db.token_blacklist.create_index([("jti", ASCENDING)], unique=True)


async def ensure_admin_user() -> None:
    db = get_database()
    admin_username = str(os.getenv("ADMIN_USERNAME") or "").strip()
    admin_password = str(os.getenv("ADMIN_PASSWORD") or "").strip()
    admin_email = str(os.getenv("ADMIN_EMAIL") or "").strip()
    admin_full_name = str(os.getenv("ADMIN_FULL_NAME") or "System Admin").strip() or "System Admin"

    if not admin_username or not admin_password or not admin_email:
        return

    now = datetime.utcnow()
    default_plan = build_plan_update("free")

    try:
        existing_admin = await db.users.find_one(
            {
                "$or": [
                    {"username": admin_username},
                    {"email": admin_email},
                ]
            }
        )
        admin_updates = {
            "full_name": admin_full_name,
            "email": admin_email,
            "username": admin_username,
            "mobile_number": f"admin-{admin_username}",
            "phone_number": f"admin-{admin_username}",
            "storage_limit": default_plan["storage_limit"],
            "account_type": default_plan["account_type"],
            "plan": default_plan["plan"],
            "is_premium": default_plan["is_premium"],
            "password_hash": hash_password(admin_password),
            "role": "admin",
            "is_active": True,
            "is_verified": True,
            "is_email_verified": True,
            "updated_at": now,
        }

        if existing_admin:
            await db.users.update_one({"_id": existing_admin["_id"]}, {"$set": admin_updates})
            logger.info("Admin user synchronized: username=%s", admin_username)
            return

        await db.users.insert_one(
            {
                "full_name": admin_full_name,
                "date_of_birth": None,
                "dob": None,
                "email": admin_email,
                "mobile_number": f"admin-{admin_username}",
                "phone_number": f"admin-{admin_username}",
                "username": admin_username,
                "profile_picture": None,
                "gender": None,
                "bio": "Platform administrator",
                "storage_used": 0,
                "storage_limit": default_plan["storage_limit"],
                "account_type": default_plan["account_type"],
                "plan": default_plan["plan"],
                "is_premium": default_plan["is_premium"],
                "two_factor_enabled": False,
                "last_login": None,
                "password_hash": hash_password(admin_password),
                "role": "admin",
                "is_active": True,
                "is_verified": True,
                "is_email_verified": True,
                "is_2fa_enabled": False,
                "auth_notifications_enabled": True,
                "created_at": now,
                "updated_at": now,
            }
        )
        logger.info("Admin user created: username=%s", admin_username)
    except PyMongoError:
        logger.exception("Failed to ensure admin user")
        raise
