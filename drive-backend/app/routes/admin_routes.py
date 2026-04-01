from __future__ import annotations

from datetime import datetime, timedelta
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core import config
from app.database.mongodb import get_database
from app.routes.deps import get_admin_user
from app.schemas.admin_schema import (
    AdminAnalyticsDailyPoint,
    AdminAnalyticsFileTypesResponse,
    AdminAnalyticsResponse,
    AdminAnalyticsStorageResponse,
    AdminAnalyticsUserGrowthPoint,
    AdminFileResponse,
    AdminStatsResponse,
    AdminUserDetailResponse,
    AdminUserResponse,
)
from app.schemas.common_schema import MessageResponse
from app.services.file_document_service import build_storage_usage_pipeline, iter_file_asset_keys
from app.services.s3_service import S3Service
from app.utils.mongo_helpers import parse_object_id
from app.utils.plans import build_plan_update
from app.utils.storage import sync_user_storage_usage

router = APIRouter(prefix="/admin", tags=["Admin"])
s3_service = S3Service()
logger = logging.getLogger(__name__)


async def _collect_all(cursor) -> list[dict]:
    docs: list[dict] = []
    async for doc in cursor:
        docs.append(doc)
    return docs


def _serialize_admin_user(user: dict, file_count: int = 0) -> AdminUserResponse:
    return AdminUserResponse(
        id=str(user["_id"]),
        full_name=user.get("full_name") or user.get("username") or user.get("email") or "User",
        email=user.get("email") or "",
        username=user.get("username") or "",
        storage_used=max(int(user.get("storage_used") or 0), 0),
        storage_limit=max(int(user.get("storage_limit") or 0), 0),
        plan=str(user.get("plan") or "free"),
        account_type=str(user.get("account_type") or "Free"),
        is_premium=bool(user.get("is_premium", False)),
        role=str(user.get("role") or "user"),
        status="active" if bool(user.get("is_active", False)) else "banned",
        is_active=bool(user.get("is_active", False)),
        is_verified=bool(user.get("is_verified", False)),
        file_count=max(int(file_count or 0), 0),
        last_login=user.get("last_login"),
        created_at=user.get("created_at"),
        updated_at=user.get("updated_at"),
    )


def _resolve_admin_file_url(request: Request | None, file_doc: dict) -> str | None:
    file_url = file_doc.get("file_url") or file_doc.get("storage_path") or ""
    if not file_url:
        return None
    if str(file_url).startswith(("http://", "https://", "mock://")):
        return str(file_url)
    if str(file_url).startswith("/uploads/"):
        if request is None:
            return str(file_url)
        return f"{str(request.base_url).rstrip('/')}/{str(file_url).lstrip('/')}"
    if config.AWS_S3_BUCKET:
        return f"https://{config.AWS_S3_BUCKET}.s3.{config.AWS_REGION}.amazonaws.com/{str(file_url).lstrip('/')}"
    if request is None:
        return str(file_url)
    return f"{str(request.base_url).rstrip('/')}/{str(file_url).lstrip('/')}"


def _serialize_admin_file(file_doc: dict, owner: dict | None = None, request: Request | None = None) -> AdminFileResponse:
    owner_name = (
        (owner or {}).get("full_name")
        or (owner or {}).get("username")
        or (owner or {}).get("email")
        or "Unknown user"
    )
    return AdminFileResponse(
        id=str(file_doc["_id"]),
        file_name=file_doc.get("file_name") or file_doc.get("filename") or "Untitled file",
        owner_id=str(file_doc.get("owner_id") or ""),
        owner_name=owner_name,
        owner_email=(owner or {}).get("email"),
        file_size=max(int(file_doc.get("file_size") or file_doc.get("size") or 0), 0),
        file_type=file_doc.get("file_type") or file_doc.get("mime_type") or "application/octet-stream",
        mime_type=file_doc.get("mime_type") or file_doc.get("file_type"),
        file_url=_resolve_admin_file_url(request, file_doc),
        folder_id=str(file_doc["folder_id"]) if file_doc.get("folder_id") else None,
        is_deleted=bool(file_doc.get("is_deleted", False)),
        created_at=file_doc.get("created_at"),
        updated_at=file_doc.get("updated_at"),
    )


async def _delete_file_assets(file_doc: dict) -> None:
    for asset_key in iter_file_asset_keys(file_doc):
        await s3_service.delete_object(asset_key)


async def _recalc_storage(db: AsyncIOMotorDatabase, owner_id) -> None:
    pipeline = build_storage_usage_pipeline(owner_id)
    data = await db.files.aggregate(pipeline).to_list(length=1)
    used = int(data[0]["used"]) if data else 0
    user = await db.users.find_one({"_id": owner_id}, {"storage_used": 1, "storage_limit": 1})
    if user:
        await sync_user_storage_usage(db, user, used)


async def _delete_user_supporting_records(
    db: AsyncIOMotorDatabase,
    *,
    user_id,
    email: str | None,
    owned_file_ids: list,
) -> None:
    share_queries = [{"owner_id": user_id}]
    shared_file_queries = [
        {"shared_with_user_id": user_id},
        {"shared_by_user_id": user_id},
    ]
    if owned_file_ids:
        share_queries.append({"file_id": {"$in": owned_file_ids}})
        shared_file_queries.append({"file_id": {"$in": owned_file_ids}})

    await db.shares.delete_many({"$or": share_queries})
    await db.shared_files.delete_many({"$or": shared_file_queries})
    await db.files.update_many(
        {
            "$or": [
                {"shared_with": user_id},
                {"share_entries.user_id": user_id},
            ]
        },
        {"$pull": {"shared_with": user_id, "share_entries": {"user_id": user_id}}},
    )
    await db.folders.update_many(
        {
            "$or": [
                {"shared_with": user_id},
                {"share_entries.user_id": user_id},
            ]
        },
        {"$pull": {"shared_with": user_id, "share_entries": {"user_id": user_id}}},
    )
    await db.activity_logs.delete_many({"user_id": user_id})
    await db.uploads.delete_many({"user_id": user_id})
    await db.storage_usage.delete_many({"user_id": user_id})
    await db.payments.delete_many({"user_id": user_id})
    if email:
        await db.otp_codes.delete_many({"email": email})


def _build_admin_storage_stats_pipeline() -> list[dict]:
    version_size_expression = {
        "$sum": {
            "$map": {
                "input": {"$ifNull": ["$versions", []]},
                "as": "version",
                "in": {"$ifNull": ["$$version.file_size", {"$ifNull": ["$$version.size", 0]}]},
            }
        }
    }
    return [
        {
            "$project": {
                "total_size": {
                    "$add": [
                        {"$ifNull": ["$file_size", {"$ifNull": ["$size", 0]}]},
                        version_size_expression,
                    ]
                }
            }
        },
        {
            "$group": {
                "_id": None,
                "total_files": {"$sum": 1},
                "total_storage_used": {"$sum": "$total_size"},
            }
        },
    ]


def _month_start(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _shift_month_start(value: datetime, offset: int) -> datetime:
    total_months = (value.year * 12 + (value.month - 1)) + offset
    year, month_index = divmod(total_months, 12)
    return value.replace(year=year, month=month_index + 1, day=1)


@router.get("/users", response_model=list[AdminUserResponse])
async def list_users(
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[AdminUserResponse]:
    users = await _collect_all(
        db.users.find(
            {},
            {
                "password_hash": 0,
            },
        ).sort("created_at", -1)
    )
    file_counts = await _collect_all(
        db.files.aggregate(
            [
                {"$group": {"_id": "$owner_id", "file_count": {"$sum": 1}}},
            ]
        )
    )
    file_count_map = {item["_id"]: int(item.get("file_count") or 0) for item in file_counts}
    return [_serialize_admin_user(user, file_count_map.get(user["_id"], 0)) for user in users]


@router.get("/user/{user_id}", response_model=AdminUserDetailResponse)
async def get_user_detail(
    user_id: str,
    request: Request,
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AdminUserDetailResponse:
    parsed_user_id = parse_object_id(user_id, "Invalid user id")
    user = await db.users.find_one({"_id": parsed_user_id}, {"password_hash": 0})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    owned_files = await _collect_all(db.files.find({"owner_id": parsed_user_id}).sort("created_at", -1))
    return AdminUserDetailResponse(
        user=_serialize_admin_user(user, file_count=len(owned_files)),
        files=[_serialize_admin_file(file_doc, user, request) for file_doc in owned_files],
    )


@router.patch("/user/{user_id}/ban", response_model=AdminUserResponse)
async def toggle_user_ban(
    user_id: str,
    current_admin: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AdminUserResponse:
    parsed_user_id = parse_object_id(user_id, "Invalid user id")
    if parsed_user_id == current_admin["_id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot ban your own account")

    user = await db.users.find_one({"_id": parsed_user_id}, {"password_hash": 0})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    next_is_active = not bool(user.get("is_active", False))
    await db.users.update_one(
        {"_id": parsed_user_id},
        {"$set": {"is_active": next_is_active, "updated_at": datetime.utcnow()}},
    )
    updated_user = await db.users.find_one({"_id": parsed_user_id}, {"password_hash": 0})
    if not updated_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    file_count = await db.files.count_documents({"owner_id": parsed_user_id})
    logger.info(
        "Admin action: toggle_user_ban admin_id=%s target_user_id=%s is_active=%s",
        current_admin.get("_id"),
        parsed_user_id,
        next_is_active,
    )
    return _serialize_admin_user(updated_user, file_count=file_count)


@router.patch("/user/{user_id}/plan/free", response_model=AdminUserResponse)
async def remove_user_premium(
    user_id: str,
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AdminUserResponse:
    parsed_user_id = parse_object_id(user_id, "Invalid user id")
    user = await db.users.find_one({"_id": parsed_user_id}, {"password_hash": 0})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    free_plan = build_plan_update("free")
    await db.users.update_one(
        {"_id": parsed_user_id},
        {"$set": {**free_plan, "updated_at": datetime.utcnow()}},
    )
    updated_user = await db.users.find_one({"_id": parsed_user_id}, {"password_hash": 0})
    if not updated_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    file_count = await db.files.count_documents({"owner_id": parsed_user_id})
    logger.info("Admin action: remove_premium user_id=%s", parsed_user_id)
    return _serialize_admin_user(updated_user, file_count=file_count)


@router.delete("/user/{user_id}", response_model=MessageResponse)
async def delete_user(
    user_id: str,
    current_admin: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    parsed_user_id = parse_object_id(user_id, "Invalid user id")
    if parsed_user_id == current_admin["_id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")

    user = await db.users.find_one({"_id": parsed_user_id}, {"password_hash": 0})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    owned_files = await _collect_all(db.files.find({"owner_id": parsed_user_id}))
    owned_file_ids = [file_doc["_id"] for file_doc in owned_files]

    if user.get("profile_picture"):
        await s3_service.delete_object(user["profile_picture"])
    for file_doc in owned_files:
        await _delete_file_assets(file_doc)

    await db.files.delete_many({"owner_id": parsed_user_id})
    await db.folders.delete_many({"owner_id": parsed_user_id})
    await _delete_user_supporting_records(
        db,
        user_id=parsed_user_id,
        email=user.get("email"),
        owned_file_ids=owned_file_ids,
    )
    await db.users.delete_one({"_id": parsed_user_id})
    logger.info("Admin action: delete_user admin_id=%s target_user_id=%s", current_admin.get("_id"), parsed_user_id)

    return MessageResponse(message="User and associated files deleted successfully")


@router.get("/files", response_model=list[AdminFileResponse])
async def list_files(
    request: Request,
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[AdminFileResponse]:
    files = await _collect_all(db.files.find({}).sort("updated_at", -1))
    owner_ids = list({file_doc.get("owner_id") for file_doc in files if file_doc.get("owner_id") is not None})
    owners: dict = {}
    if owner_ids:
        owner_docs = await _collect_all(
            db.users.find(
                {"_id": {"$in": owner_ids}},
                {"full_name": 1, "username": 1, "email": 1},
            )
        )
        owners = {owner["_id"]: owner for owner in owner_docs}

    return [_serialize_admin_file(file_doc, owners.get(file_doc.get("owner_id")), request) for file_doc in files]


@router.delete("/file/{file_id}", response_model=MessageResponse)
async def delete_file(
    file_id: str,
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    parsed_file_id = parse_object_id(file_id, "Invalid file id")
    file_doc = await db.files.find_one({"_id": parsed_file_id})
    if not file_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    owner_id = file_doc.get("owner_id")
    await _delete_file_assets(file_doc)
    await db.files.delete_one({"_id": parsed_file_id})
    await db.shares.delete_many({"file_id": parsed_file_id})
    await db.shared_files.delete_many({"file_id": parsed_file_id})
    if owner_id is not None:
        await _recalc_storage(db, owner_id)
    logger.info("Admin action: delete_file file_id=%s owner_id=%s", parsed_file_id, owner_id)

    return MessageResponse(message="File deleted successfully")


@router.get("/file/{file_id}/preview")
async def preview_admin_file(
    file_id: str,
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    parsed_file_id = parse_object_id(file_id, "Invalid file id")
    file_doc = await db.files.find_one({"_id": parsed_file_id})
    if not file_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    key_or_url = file_doc.get("s3_key") or file_doc.get("file_url") or file_doc.get("storage_path")
    if not key_or_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File storage path not found")

    s3_response = await s3_service.get_object(key_or_url)
    body = s3_response["Body"]
    headers = {
        "Content-Type": s3_response.get("ContentType", "application/octet-stream"),
    }
    if "ContentLength" in s3_response:
        headers["Content-Length"] = str(s3_response["ContentLength"])

    return StreamingResponse(body.iter_chunks(), status_code=status.HTTP_200_OK, headers=headers)


@router.get("/stats", response_model=AdminStatsResponse)
async def get_admin_stats(
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AdminStatsResponse:
    total_users = await db.users.count_documents({})
    file_stats = await db.files.aggregate(_build_admin_storage_stats_pipeline()).to_list(length=1)
    summary = file_stats[0] if file_stats else {}
    return AdminStatsResponse(
        total_users=total_users,
        total_files=max(int(summary.get("total_files") or 0), 0),
        total_storage_used=max(int(summary.get("total_storage_used") or 0), 0),
    )


@router.get("/analytics", response_model=AdminAnalyticsResponse)
async def get_admin_analytics(
    _: dict = Depends(get_admin_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> AdminAnalyticsResponse:
    now = datetime.utcnow()
    current_day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    upload_window_start = current_day_start - timedelta(days=6)
    current_month = _month_start(now)
    first_growth_month = _shift_month_start(current_month, -5)

    file_stats = await db.files.aggregate(_build_admin_storage_stats_pipeline()).to_list(length=1)
    file_summary = file_stats[0] if file_stats else {}
    total_storage_used = max(int(file_summary.get("total_storage_used") or 0), 0)

    user_capacity = await db.users.aggregate(
        [
            {
                "$group": {
                    "_id": None,
                    "total_limit": {"$sum": {"$ifNull": ["$storage_limit", 0]}},
                }
            }
        ]
    ).to_list(length=1)
    total_storage_capacity = max(int((user_capacity[0] if user_capacity else {}).get("total_limit") or 0), 0)
    total_storage_free = max(total_storage_capacity - total_storage_used, 0)

    file_type_rows = await db.files.aggregate(
        [
            {"$match": {"is_deleted": {"$ne": True}}},
            {
                "$project": {
                    "mime_group": {
                        "$toLower": {
                            "$ifNull": ["$mime_type", {"$ifNull": ["$file_type", ""]}]
                        }
                    }
                }
            },
            {
                "$project": {
                    "category": {
                        "$switch": {
                            "branches": [
                                {
                                    "case": {
                                        "$regexMatch": {
                                            "input": "$mime_group",
                                            "regex": r"^image/",
                                        }
                                    },
                                    "then": "image",
                                },
                                {
                                    "case": {
                                        "$regexMatch": {
                                            "input": "$mime_group",
                                            "regex": r"^video/",
                                        }
                                    },
                                    "then": "video",
                                },
                                {
                                    "case": {
                                        "$regexMatch": {
                                            "input": "$mime_group",
                                            "regex": "pdf",
                                        }
                                    },
                                    "then": "pdf",
                                },
                            ],
                            "default": "other",
                        }
                    }
                }
            },
            {
                "$group": {
                    "_id": "$category",
                    "count": {"$sum": 1},
                }
            },
        ]
    ).to_list(length=10)
    file_type_map = {
        "image": 0,
        "video": 0,
        "pdf": 0,
        "other": 0,
    }
    for row in file_type_rows:
        category = str(row.get("_id") or "other")
        if category not in file_type_map:
            category = "other"
        file_type_map[category] = max(int(row.get("count") or 0), 0)

    upload_rows = await db.files.aggregate(
        [
            {
                "$match": {
                    "created_at": {"$gte": upload_window_start},
                }
            },
            {
                "$group": {
                    "_id": {
                        "$dateToString": {
                            "format": "%Y-%m-%d",
                            "date": "$created_at",
                        }
                    },
                    "count": {"$sum": 1},
                }
            },
            {"$sort": {"_id": 1}},
        ]
    ).to_list(length=20)
    upload_map = {str(row["_id"]): max(int(row.get("count") or 0), 0) for row in upload_rows if row.get("_id")}
    uploads_last_7_days = [
        AdminAnalyticsDailyPoint(
            date=day.strftime("%Y-%m-%d"),
            count=upload_map.get(day.strftime("%Y-%m-%d"), 0),
        )
        for day in (upload_window_start + timedelta(days=offset) for offset in range(7))
    ]

    growth_rows = await db.users.aggregate(
        [
            {
                "$match": {
                    "created_at": {"$gte": first_growth_month},
                }
            },
            {
                "$group": {
                    "_id": {
                        "$dateToString": {
                            "format": "%Y-%m",
                            "date": "$created_at",
                        }
                    },
                    "users": {"$sum": 1},
                }
            },
            {"$sort": {"_id": 1}},
        ]
    ).to_list(length=12)
    growth_map = {str(row["_id"]): max(int(row.get("users") or 0), 0) for row in growth_rows if row.get("_id")}
    user_growth = []
    for offset in range(6):
        month_start = _shift_month_start(first_growth_month, offset)
        month_key = month_start.strftime("%Y-%m")
        user_growth.append(
            AdminAnalyticsUserGrowthPoint(
                month=month_start.strftime("%b"),
                users=growth_map.get(month_key, 0),
            )
        )

    return AdminAnalyticsResponse(
        storage=AdminAnalyticsStorageResponse(
            used=total_storage_used,
            free=total_storage_free,
        ),
        file_types=AdminAnalyticsFileTypesResponse(**file_type_map),
        uploads_last_7_days=uploads_last_7_days,
        user_growth=user_growth,
    )
