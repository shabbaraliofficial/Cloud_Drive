from __future__ import annotations
import os
from typing import Any

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "cloud_drive_db")

client: AsyncIOMotorClient | None = None
database: AsyncIOMotorDatabase | None = None


async def connect_to_mongo() -> None:
    global client, database
    client = AsyncIOMotorClient(MONGODB_URL)
    database = client[MONGODB_DB_NAME]
    await test_mongo_connection()
    await ensure_indexes()


async def close_mongo_connection() -> None:
    global client
    if client is not None:
        client.close()


def get_database() -> AsyncIOMotorDatabase:
    if database is None:
        raise RuntimeError("MongoDB is not connected")
    return database


async def test_mongo_connection() -> dict[str, Any]:
    db = get_database()
    return await db.command("ping")


async def ensure_indexes() -> None:
    db = get_database()
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.users.create_index([("username", ASCENDING)], unique=True)
    await db.users.create_index([("mobile_number", ASCENDING)], unique=True)
    await db.otp_codes.create_index([("email", ASCENDING), ("purpose", ASCENDING), ("created_at", DESCENDING)])
    await db.files.create_index([("owner_id", ASCENDING), ("is_deleted", ASCENDING), ("updated_at", DESCENDING)])
    await db.folders.create_index([("owner_id", ASCENDING), ("is_deleted", ASCENDING), ("updated_at", DESCENDING)])
    await db.files.create_index([("shared_with", ASCENDING), ("share_expiry", ASCENDING)])
    await db.folders.create_index([("shared_with", ASCENDING), ("share_expiry", ASCENDING)])
    await db.shared_files.create_index([("shared_with_user_id", ASCENDING), ("created_at", DESCENDING)])
    await db.shares.create_index([("share_token", ASCENDING)], unique=True)
    await db.token_blacklist.create_index([("jti", ASCENDING)], unique=True)

