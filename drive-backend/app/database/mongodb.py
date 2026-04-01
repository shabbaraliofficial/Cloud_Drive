from __future__ import annotations

from datetime import datetime
import json
import logging
import os
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import ConfigurationError, PyMongoError

from app.core import config
from app.utils.password_handler import hash_password
from app.utils.plans import build_plan_update

logger = logging.getLogger(__name__)

_MONGO_DOH_PROVIDERS = (
    "https://dns.google/resolve",
    "https://cloudflare-dns.com/dns-query",
)

client: AsyncIOMotorClient | None = None
database: AsyncIOMotorDatabase | None = None
database_error: str | None = "MongoDB is not connected"


def _fetch_doh_record(name: str, record_type: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for endpoint in _MONGO_DOH_PROVIDERS:
        url = f"{endpoint}?name={name}&type={record_type}"
        request = Request(url, headers={"Accept": "application/dns-json", "User-Agent": "cloud-drive-backend"})
        try:
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
            status_code = int(payload.get("Status", -1))
            if status_code != 0:
                raise ValueError(f"DNS-over-HTTPS lookup failed for {name} {record_type} with status {status_code}")
            return payload
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"DNS-over-HTTPS lookup failed for {name} {record_type}: {last_error}") from last_error


def _parse_srv_hosts(payload: dict[str, Any]) -> list[str]:
    hosts: list[str] = []
    for answer in payload.get("Answer", []):
        data = str(answer.get("data") or "").strip()
        if not data:
            continue
        parts = data.split()
        if len(parts) != 4:
            continue
        _, _, port, host = parts
        hosts.append(f"{host.rstrip('.')}:{port}")
    if not hosts:
        raise ValueError("No SRV hosts were returned for the MongoDB Atlas cluster")
    return hosts


def _parse_txt_options(payload: dict[str, Any]) -> dict[str, str]:
    options: dict[str, str] = {}
    for answer in payload.get("Answer", []):
        data = str(answer.get("data") or "").strip().strip('"')
        if not data:
            continue
        for key, value in parse_qsl(data, keep_blank_values=True):
            options[key] = value
    return options


def _build_mongo_doh_fallback_uri(mongo_url: str) -> str:
    parsed = urlsplit(mongo_url)
    if parsed.scheme != "mongodb+srv":
        return mongo_url

    if "@" in parsed.netloc:
        userinfo, hostname = parsed.netloc.rsplit("@", 1)
        auth_prefix = f"{userinfo}@"
    else:
        hostname = parsed.netloc
        auth_prefix = ""

    hostname = hostname.strip()
    if not hostname:
        raise ValueError("MongoDB SRV URI is missing a hostname")

    srv_payload = _fetch_doh_record(f"_mongodb._tcp.{hostname}", "SRV")
    txt_payload = _fetch_doh_record(hostname, "TXT")
    hosts = _parse_srv_hosts(srv_payload)

    merged_options = _parse_txt_options(txt_payload)
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        merged_options[key] = value

    if "tls" not in merged_options and "ssl" not in merged_options:
        merged_options["tls"] = "true"

    path = parsed.path or "/"
    query = urlencode(merged_options, doseq=True)
    fallback_uri = urlunsplit(("mongodb", f"{auth_prefix}{','.join(hosts)}", path, query, ""))
    logger.info(
        "Resolved MongoDB Atlas SRV URI via DNS-over-HTTPS: hostname=%s hosts=%s",
        hostname,
        hosts,
    )
    return fallback_uri


async def connect_to_mongo() -> None:
    global client, database, database_error

    mongo_url = str(config.MONGO_URL or "").strip()
    logger.info("MONGO_URL exists: %s", bool(mongo_url))

    if not mongo_url:
        database_error = "MONGO_URL is not set"
        client = None
        database = None
        logger.error(database_error)
        return

    if not mongo_url.startswith(("mongodb://", "mongodb+srv://")):
        database_error = "MongoDB URL must be a full MongoDB URI. Set MONGO_URL to a value like mongodb+srv://..."
        client = None
        database = None
        logger.error(database_error)
        return

    try:
        resolved_mongo_url = mongo_url
        if mongo_url.startswith("mongodb+srv://"):
            try:
                resolved_mongo_url = _build_mongo_doh_fallback_uri(mongo_url)
            except Exception as exc:
                logger.warning("MongoDB SRV DNS-over-HTTPS fallback unavailable; using original SRV URI: %s", exc)
        client = AsyncIOMotorClient(resolved_mongo_url, serverSelectionTimeoutMS=10000)
        try:
            database = client.get_default_database()
        except ConfigurationError:
            database = None

        if database is None:
            if config.MONGODB_DB_NAME:
                database = client[config.MONGODB_DB_NAME]
            else:
                raise ValueError("MONGO_URL must include a database name or set MONGODB_DB_NAME")
        logger.info("MongoDB database selected: %s", database.name)
        await client.admin.command("ping")
        database_error = None
        logger.info("MongoDB connected successfully")
        await ensure_indexes()
        await ensure_admin_user()
    except Exception as exc:
        database_error = str(exc)
        logger.error("MongoDB connection failed", exc_info=True)
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
            detail="Database not available",
        )
    return database


async def test_mongo_connection() -> dict[str, Any]:
    global database_error

    if client is None or database is None:
        return {"ok": 0.0, "error": database_error or "MongoDB is not connected"}

    try:
        result = await client.admin.command("ping")
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
