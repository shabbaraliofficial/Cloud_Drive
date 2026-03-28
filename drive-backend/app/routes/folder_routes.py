from __future__ import annotations
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.routes.serializers import serialize_folder
from app.schemas.common_schema import MessageResponse
from app.schemas.file_schema import FolderCreateRequest, FolderResponse, RenameRequest
from app.services.s3_service import S3Service
from app.utils.access_control import ensure_folder_write_access
from app.utils.mongo_helpers import parse_object_id

router = APIRouter(prefix="/api/folders", tags=["Folders"])
s3_service = S3Service()


class ShareFolderRequest(BaseModel):
    folder_id: str
    user_id: str
    expiry_hours: int = Field(default=1, ge=1, le=168)


async def _collect_descendant_folder_ids(
    db: AsyncIOMotorDatabase,
    owner_id,
    root_folder_id,
) -> list:
    collected: list = []
    queue = [root_folder_id]

    while queue:
        parent_id = queue.pop(0)
        children = await db.folders.find(
            {"owner_id": owner_id, "$or": [{"parent_folder_id": parent_id}, {"parent_folder": parent_id}]},
            {"_id": 1},
        ).to_list(1000)
        child_ids = [item["_id"] for item in children if item.get("_id")]
        for child_id in child_ids:
            if child_id not in collected:
                collected.append(child_id)
                queue.append(child_id)

    return collected


def _build_folder_document(name: str, owner_id, parent_id) -> dict:
    now = datetime.utcnow()
    return {
        "name": name,
        "owner_id": owner_id,
        "parent_folder_id": parent_id,
        "parent_folder": parent_id,
        "is_deleted": False,
        "deleted_at": None,
        "is_starred": False,
        "shared_with": [],
        "share_entries": [],
        "share_expiry": None,
        "permission": "write",
        "expires_at": None,
        "created_at": now,
        "updated_at": now,
    }


@router.post("", response_model=FolderResponse)
async def create_folder(
    payload: FolderCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FolderResponse:
    parent_ref = payload.parent_folder_id or payload.parent_folder
    parent_id = parse_object_id(parent_ref, "Invalid parent folder id") if parent_ref else None
    if parent_id:
        parent = await db.folders.find_one({"_id": parent_id, "is_deleted": {"$ne": True}})
        await ensure_folder_write_access(db, parent, current_user)
    result = await db.folders.insert_one(_build_folder_document(payload.name, current_user["_id"], parent_id))
    doc = await db.folders.find_one({"_id": result.inserted_id})
    assert doc
    return serialize_folder(doc)


@router.get("", response_model=list[FolderResponse])
async def list_folders(
    section: str = Query(default="drive", pattern="^(drive|recent|bin|starred)$"),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FolderResponse]:
    query: dict = {"owner_id": current_user["_id"]}
    if section == "bin":
        query["is_deleted"] = True
    else:
        query["is_deleted"] = {"$ne": True}
        if section == "starred":
            query["is_starred"] = True
    limit = 20 if section == "recent" else 500
    docs = await db.folders.find(query).sort("updated_at", -1).to_list(limit)
    return [serialize_folder(item) for item in docs]


@router.patch("/{folder_id}/rename", response_model=FolderResponse)
async def rename_folder(
    folder_id: str,
    payload: RenameRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FolderResponse:
    parsed_id = parse_object_id(folder_id, "Invalid folder id")
    existing = await db.folders.find_one({"_id": parsed_id, "is_deleted": {"$ne": True}})
    await ensure_folder_write_access(db, existing, current_user)
    await db.folders.update_one(
        {"_id": parsed_id},
        {"$set": {"name": payload.new_name, "updated_at": datetime.utcnow()}},
    )
    doc = await db.folders.find_one({"_id": parsed_id})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    return serialize_folder(doc)


@router.post("/share", response_model=dict)
async def share_folder(
    payload: ShareFolderRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_folder_id = parse_object_id(payload.folder_id, "Invalid folder id")
    target_user_id = parse_object_id(payload.user_id, "Invalid target user id")

    folder_doc = await db.folders.find_one(
        {"_id": parsed_folder_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}}
    )
    if not folder_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    if str(target_user_id) == str(current_user["_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You already own this folder")

    target_user = await db.users.find_one({"_id": target_user_id, "is_active": True})
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    now = datetime.utcnow()
    expires_at = now + timedelta(hours=int(payload.expiry_hours))
    share_entry = {
        "user_id": target_user_id,
        "expires_at": expires_at,
        "permission": "read",
        "shared_at": now,
    }

    await db.folders.update_one(
        {"_id": parsed_folder_id, "owner_id": current_user["_id"]},
        {
            "$pull": {"share_entries": {"user_id": target_user_id}},
            "$addToSet": {"shared_with": target_user_id},
            "$set": {"expires_at": expires_at, "share_expiry": expires_at, "permission": "read", "updated_at": now},
        },
    )
    await db.folders.update_one(
        {"_id": parsed_folder_id, "owner_id": current_user["_id"]},
        {"$push": {"share_entries": share_entry}},
    )

    updated_folder = await db.folders.find_one({"_id": parsed_folder_id, "owner_id": current_user["_id"]})
    assert updated_folder

    return {
        "message": "Folder shared successfully",
        "folder": serialize_folder(updated_folder),
        "shared_with_user_id": str(target_user_id),
        "shared_with_username": target_user.get("username") or target_user.get("email") or "user",
        "expires_at": expires_at,
        "permission": "read",
    }


@router.delete("/{folder_id}", response_model=MessageResponse)
async def delete_folder(
    folder_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    parsed_id = parse_object_id(folder_id, "Invalid folder id")
    now = datetime.utcnow()
    result = await db.folders.update_one(
        {"_id": parsed_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}},
        {"$set": {"is_deleted": True, "deleted_at": now, "updated_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    descendants = await _collect_descendant_folder_ids(db, current_user["_id"], parsed_id)
    folder_ids = [parsed_id, *descendants]

    await db.folders.update_many(
        {"owner_id": current_user["_id"], "_id": {"$in": folder_ids}},
        {"$set": {"is_deleted": True, "deleted_at": now, "updated_at": now}},
    )
    await db.files.update_many(
        {"owner_id": current_user["_id"], "folder_id": {"$in": folder_ids}, "is_deleted": {"$ne": True}},
        {"$set": {"is_deleted": True, "deleted_at": now, "updated_at": now}},
    )
    return MessageResponse(message="Folder moved to bin")


@router.post("/{folder_id}/restore", response_model=FolderResponse)
async def restore_folder(
    folder_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FolderResponse:
    parsed_id = parse_object_id(folder_id, "Invalid folder id")
    now = datetime.utcnow()
    await db.folders.update_one(
        {"_id": parsed_id, "owner_id": current_user["_id"]},
        {"$set": {"is_deleted": False, "deleted_at": None, "updated_at": now}},
    )

    descendants = await _collect_descendant_folder_ids(db, current_user["_id"], parsed_id)
    folder_ids = [parsed_id, *descendants]

    await db.folders.update_many(
        {"owner_id": current_user["_id"], "_id": {"$in": folder_ids}},
        {"$set": {"is_deleted": False, "deleted_at": None, "updated_at": now}},
    )
    await db.files.update_many(
        {"owner_id": current_user["_id"], "folder_id": {"$in": folder_ids}},
        {"$set": {"is_deleted": False, "deleted_at": None, "updated_at": now}},
    )
    doc = await db.folders.find_one({"_id": parsed_id, "owner_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    return serialize_folder(doc)


@router.delete("/{folder_id}/permanent", response_model=MessageResponse)
async def permanently_delete_folder(
    folder_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    parsed_id = parse_object_id(folder_id, "Invalid folder id")
    folder = await db.folders.find_one({"_id": parsed_id, "owner_id": current_user["_id"]})
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    descendants = await _collect_descendant_folder_ids(db, current_user["_id"], parsed_id)
    folder_ids = [parsed_id, *descendants]

    files = await db.files.find({"owner_id": current_user["_id"], "folder_id": {"$in": folder_ids}}).to_list(5000)
    for file_doc in files:
        primary_key = file_doc.get("s3_key") or file_doc.get("storage_path") or file_doc.get("file_url")
        thumbnail_url = file_doc.get("thumbnail_url")
        if primary_key:
            await s3_service.delete_file_from_s3(primary_key)
        if thumbnail_url and thumbnail_url != primary_key:
            await s3_service.delete_object(thumbnail_url)

    await db.files.delete_many({"owner_id": current_user["_id"], "folder_id": {"$in": folder_ids}})
    await db.folders.delete_many({"owner_id": current_user["_id"], "_id": {"$in": folder_ids}})
    return MessageResponse(message="Folder permanently deleted")


