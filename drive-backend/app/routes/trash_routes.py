from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.routes.folder_routes import _collect_descendant_folder_ids
from app.routes.serializers import serialize_file, serialize_folder
from app.schemas.common_schema import MessageResponse
from app.services.file_document_service import build_storage_usage_pipeline, iter_file_asset_keys
from app.services.s3_service import S3Service
from app.utils.mongo_helpers import parse_object_id
from app.utils.storage import sync_user_storage_usage

router = APIRouter(prefix="/api/trash", tags=["Trash"])
s3_service = S3Service()


async def _recalc_storage(db: AsyncIOMotorDatabase, owner_id) -> None:
    pipeline = build_storage_usage_pipeline(owner_id)
    data = await db.files.aggregate(pipeline).to_list(length=1)
    used = int(data[0]["used"]) if data else 0
    user = await db.users.find_one({"_id": owner_id}, {"storage_used": 1, "storage_limit": 1})
    if user:
        await sync_user_storage_usage(db, user, used)


async def _delete_file_assets(file_doc: dict) -> None:
    for asset_key in iter_file_asset_keys(file_doc):
        await s3_service.delete_object(asset_key)


async def _restore_folder_tree(db: AsyncIOMotorDatabase, owner_id, folder_id) -> dict | None:
    now = datetime.utcnow()
    descendants = await _collect_descendant_folder_ids(db, owner_id, folder_id)
    folder_ids = [folder_id, *descendants]

    await db.folders.update_many(
        {"owner_id": owner_id, "_id": {"$in": folder_ids}},
        {"$set": {"is_deleted": False, "deleted_at": None, "updated_at": now}},
    )
    await db.files.update_many(
        {"owner_id": owner_id, "folder_id": {"$in": folder_ids}},
        {"$set": {"is_deleted": False, "deleted_at": None, "updated_at": now}},
    )
    return await db.folders.find_one({"_id": folder_id, "owner_id": owner_id})


async def _purge_folder_tree(db: AsyncIOMotorDatabase, owner_id, folder_id) -> None:
    descendants = await _collect_descendant_folder_ids(db, owner_id, folder_id)
    folder_ids = [folder_id, *descendants]
    files = await db.files.find(
        {"owner_id": owner_id, "folder_id": {"$in": folder_ids}}
    ).to_list(length=5000)

    for file_doc in files:
        await _delete_file_assets(file_doc)

    await db.files.delete_many({"owner_id": owner_id, "folder_id": {"$in": folder_ids}})
    await db.folders.delete_many({"owner_id": owner_id, "_id": {"$in": folder_ids}})


@router.get("")
async def list_trash(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    files = await db.files.find(
        {"owner_id": current_user["_id"], "is_deleted": True}
    ).sort("deleted_at", -1).to_list(length=1000)
    folders = await db.folders.find(
        {"owner_id": current_user["_id"], "is_deleted": True}
    ).sort("deleted_at", -1).to_list(length=1000)

    return {
        "files": [serialize_file(item) for item in files],
        "folders": [serialize_folder(item) for item in folders],
        "total_items": len(files) + len(folders),
    }


@router.post("/restore/{item_id}")
async def restore_trash_item(
    item_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_id = parse_object_id(item_id, "Invalid item id")
    now = datetime.utcnow()

    file_doc = await db.files.find_one(
        {"_id": parsed_id, "owner_id": current_user["_id"], "is_deleted": True}
    )
    if file_doc:
        await db.files.update_one(
            {"_id": parsed_id, "owner_id": current_user["_id"]},
            {"$set": {"is_deleted": False, "deleted_at": None, "updated_at": now}},
        )
        doc = await db.files.find_one({"_id": parsed_id, "owner_id": current_user["_id"]})
        await _recalc_storage(db, current_user["_id"])
        return {"type": "file", "item": serialize_file(doc), "message": "File restored"}

    folder_doc = await db.folders.find_one(
        {"_id": parsed_id, "owner_id": current_user["_id"], "is_deleted": True}
    )
    if folder_doc:
        doc = await _restore_folder_tree(db, current_user["_id"], parsed_id)
        await _recalc_storage(db, current_user["_id"])
        return {"type": "folder", "item": serialize_folder(doc), "message": "Folder restored"}

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trash item not found")


async def _permanently_delete_trash_item(
    item_id: str,
    current_user: dict,
    db: AsyncIOMotorDatabase,
) -> MessageResponse:
    parsed_id = parse_object_id(item_id, "Invalid item id")

    file_doc = await db.files.find_one(
        {"_id": parsed_id, "owner_id": current_user["_id"], "is_deleted": True}
    )
    if file_doc:
        await _delete_file_assets(file_doc)
        await db.files.delete_one({"_id": parsed_id, "owner_id": current_user["_id"]})
        await _recalc_storage(db, current_user["_id"])
        return MessageResponse(message="File permanently deleted")

    folder_doc = await db.folders.find_one(
        {"_id": parsed_id, "owner_id": current_user["_id"], "is_deleted": True}
    )
    if folder_doc:
        await _purge_folder_tree(db, current_user["_id"], parsed_id)
        await _recalc_storage(db, current_user["_id"])
        return MessageResponse(message="Folder permanently deleted")

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trash item not found")


@router.delete("/{item_id}", response_model=MessageResponse)
async def permanently_delete_trash_item(
    item_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    return await _permanently_delete_trash_item(item_id, current_user, db)


@router.post("/delete/{item_id}", response_model=MessageResponse)
async def permanently_delete_trash_item_legacy(
    item_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    return await _permanently_delete_trash_item(item_id, current_user, db)


@router.post("/empty", response_model=MessageResponse)
async def empty_trash(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    files = await db.files.find(
        {"owner_id": current_user["_id"], "is_deleted": True}
    ).to_list(length=5000)

    for file_doc in files:
        await _delete_file_assets(file_doc)

    await db.files.delete_many({"owner_id": current_user["_id"], "is_deleted": True})
    await db.folders.delete_many({"owner_id": current_user["_id"], "is_deleted": True})
    await _recalc_storage(db, current_user["_id"])

    return MessageResponse(message="Trash emptied")
