from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.utils.access_control import normalize_permission
from app.utils.mongo_helpers import parse_object_id

router = APIRouter(prefix="/api/share", tags=["Sharing"])

DURATION_TO_DELTA = {
    "1h": timedelta(hours=1),
    "2h": timedelta(hours=2),
    "1d": timedelta(days=1),
}


class ShareItemRequest(BaseModel):
    item_type: str = Field(pattern="^(file|folder)$")
    item_id: str
    user_id: str
    permission: str = Field(default="read", pattern="^(read|write)$")
    duration: str = Field(default="1d", pattern="^(1h|2h|1d)$")


async def _resolve_target_user(db: AsyncIOMotorDatabase, user_id):
    target_user = await db.users.find_one({"_id": user_id, "is_active": True})
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    return target_user


def _share_entry(user_id, permission: str, expires_at: datetime) -> dict:
    return {
        "user_id": user_id,
        "permission": normalize_permission(permission),
        "expires_at": expires_at,
        "shared_at": datetime.utcnow(),
    }


@router.post("", response_model=dict)
async def share_item(
    payload: ShareItemRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_item_id = parse_object_id(payload.item_id, f"Invalid {payload.item_type} id")
    target_user_id = parse_object_id(payload.user_id, "Invalid target user id")

    if str(target_user_id) == str(current_user["_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You already own this item")

    target_user = await _resolve_target_user(db, target_user_id)
    expires_at = datetime.utcnow() + DURATION_TO_DELTA[payload.duration]
    permission = normalize_permission(payload.permission)

    if payload.item_type == "file":
        file_doc = await db.files.find_one(
            {"_id": parsed_item_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}}
        )
        if not file_doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

        share_entry = _share_entry(target_user_id, permission, expires_at)
        await db.files.update_one(
            {"_id": parsed_item_id, "owner_id": current_user["_id"]},
            {
                "$pull": {"share_entries": {"user_id": target_user_id}},
                "$addToSet": {"shared_with": target_user_id},
                "$set": {
                    "permission": permission,
                    "share_expiry": expires_at,
                    "updated_at": datetime.utcnow(),
                },
            },
        )
        await db.files.update_one(
            {"_id": parsed_item_id, "owner_id": current_user["_id"]},
            {"$push": {"share_entries": share_entry}},
        )
        await db.shared_files.update_one(
            {"file_id": parsed_item_id, "shared_with_user_id": target_user_id},
            {
                "$set": {
                    "shared_by_user_id": current_user["_id"],
                    "permission": permission,
                    "share_expiry": expires_at,
                    "updated_at": datetime.utcnow(),
                },
                "$setOnInsert": {"created_at": datetime.utcnow()},
            },
            upsert=True,
        )
    else:
        folder_doc = await db.folders.find_one(
            {"_id": parsed_item_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}}
        )
        if not folder_doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

        share_entry = _share_entry(target_user_id, permission, expires_at)
        await db.folders.update_one(
            {"_id": parsed_item_id, "owner_id": current_user["_id"]},
            {
                "$pull": {"share_entries": {"user_id": target_user_id}},
                "$addToSet": {"shared_with": target_user_id},
                "$set": {
                    "permission": permission,
                    "share_expiry": expires_at,
                    "expires_at": expires_at,
                    "updated_at": datetime.utcnow(),
                },
            },
        )
        await db.folders.update_one(
            {"_id": parsed_item_id, "owner_id": current_user["_id"]},
            {"$push": {"share_entries": share_entry}},
        )

    return {
        "message": f"{payload.item_type.title()} shared successfully",
        "item_type": payload.item_type,
        "item_id": payload.item_id,
        "shared_with_user_id": str(target_user_id),
        "shared_with_username": target_user.get("username") or target_user.get("email") or "user",
        "permission": permission,
        "duration": payload.duration,
        "expires_at": expires_at,
    }
