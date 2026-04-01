from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core import config
from app.services.file_document_service import build_storage_usage_pipeline
from app.utils.plans import build_plan_update, infer_plan_from_user, normalize_plan

# Kept only to migrate older records that were seeded with the previous default.
LEGACY_DEFAULT_STORAGE_LIMIT_BYTES = 15 * 1024 * 1024 * 1024


def get_default_storage_limit() -> int:
    return int(config.DEFAULT_STORAGE_QUOTA_BYTES)


def _format_storage_bytes(value: int) -> str:
    safe_value = max(int(value or 0), 0)
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(safe_value)
    unit_index = 0

    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1

    if unit_index == 0:
        return f"{int(size)} {units[unit_index]}"
    return f"{size:.1f} {units[unit_index]}"


def normalize_storage_limit(value) -> int:
    default_limit = get_default_storage_limit()

    try:
        limit = int(value)
    except (TypeError, ValueError):
        return default_limit

    if limit <= 0:
        return default_limit

    if limit == LEGACY_DEFAULT_STORAGE_LIMIT_BYTES:
        return default_limit

    return limit


async def get_user_storage_used_bytes(
    db: AsyncIOMotorDatabase,
    user_id,
) -> int:
    pipeline = build_storage_usage_pipeline(user_id)
    data = await db.files.aggregate(pipeline).to_list(length=1)
    return int(data[0]["used"]) if data else 0


def build_storage_payload(
    used: int = 0,
    total: int | None = None,
    *,
    file_count: int | None = None,
) -> dict:
    safe_used = max(int(used or 0), 0)
    safe_total = normalize_storage_limit(total)
    remaining = max(safe_total - safe_used, 0)
    used_percent = round((safe_used / safe_total * 100) if safe_total else 0, 2)

    payload = {
        "used": safe_used,
        "total": safe_total,
        "remaining": remaining,
        "limit": safe_total,
        "used_bytes": safe_used,
        "quota_bytes": safe_total,
        "available_bytes": remaining,
        "used_percent": used_percent,
    }

    if file_count is not None:
        payload["file_count"] = max(int(file_count or 0), 0)

    return payload


async def ensure_user_storage_limit(
    db: AsyncIOMotorDatabase,
    user: dict,
) -> int:
    user_id = user["_id"]
    resolved_plan = normalize_plan(infer_plan_from_user(user))
    plan_update = build_plan_update(resolved_plan)
    normalized_limit = normalize_storage_limit(user.get("storage_limit"))
    stored_limit = user.get("storage_limit")

    user_updates: dict = {}

    if user.get("plan") != plan_update["plan"]:
        user_updates["plan"] = plan_update["plan"]
        user["plan"] = plan_update["plan"]

    if bool(user.get("is_premium", False)) != bool(plan_update["is_premium"]):
        user_updates["is_premium"] = plan_update["is_premium"]
        user["is_premium"] = plan_update["is_premium"]

    if str(user.get("account_type") or "").strip() != str(plan_update["account_type"]):
        user_updates["account_type"] = plan_update["account_type"]
        user["account_type"] = plan_update["account_type"]

    needs_user_update = False
    try:
        needs_user_update = int(stored_limit) != normalized_limit
    except (TypeError, ValueError):
        needs_user_update = True

    if needs_user_update:
        user_updates["storage_limit"] = normalized_limit
        user["storage_limit"] = normalized_limit

    if user_updates:
        user_updates["updated_at"] = datetime.utcnow()
        await db.users.update_one({"_id": user_id}, {"$set": user_updates})

    usage_doc = await db.storage_usage.find_one({"user_id": user_id}, {"quota_bytes": 1})
    usage_limit = normalize_storage_limit(usage_doc.get("quota_bytes")) if usage_doc else normalized_limit

    if not usage_doc or usage_limit != normalized_limit:
        await db.storage_usage.update_one(
            {"user_id": user_id},
            {
                "$set": {"quota_bytes": normalized_limit, "updated_at": datetime.utcnow()},
                "$setOnInsert": {"used_bytes": max(int(user.get("storage_used", 0) or 0), 0)},
            },
            upsert=True,
        )

    return normalized_limit


async def ensure_storage_capacity(
    db: AsyncIOMotorDatabase,
    user: dict,
    additional_bytes: int = 0,
) -> dict:
    used = await get_user_storage_used_bytes(db, user["_id"])
    payload = await sync_user_storage_usage(db, user, used)

    extra = max(int(additional_bytes or 0), 0)
    if extra and payload["used"] + extra > payload["total"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Storage limit reached. "
                f"Used {_format_storage_bytes(payload['used'])} of {_format_storage_bytes(payload['total'])}. "
                "Delete files or upgrade your plan to upload more."
            ),
        )

    return payload


async def sync_user_storage_usage(
    db: AsyncIOMotorDatabase,
    user: dict,
    used: int,
    *,
    total: int | None = None,
) -> dict:
    normalized_total = total if total is not None else await ensure_user_storage_limit(db, user)
    payload = build_storage_payload(used, normalized_total)

    await db.storage_usage.update_one(
        {"user_id": user["_id"]},
        {
            "$set": {
                "used_bytes": payload["used"],
                "quota_bytes": payload["total"],
                "updated_at": datetime.utcnow(),
            }
        },
        upsert=True,
    )
    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "storage_used": payload["used"],
                "storage_limit": payload["total"],
                "updated_at": datetime.utcnow(),
            }
        },
    )
    user["storage_used"] = payload["used"]
    user["storage_limit"] = payload["total"]
    return payload
