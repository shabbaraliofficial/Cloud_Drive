from __future__ import annotations
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.routes.serializers import serialize_file
from app.schemas.common_schema import MessageResponse
from app.schemas.file_schema import FileResponse, MoveFileRequest, ShareFileRequest, StarFileRequest
from app.utils.access_control import build_active_file_share_query
from app.utils.mongo_helpers import parse_object_id
from app.utils.query_helpers import get_accessible_shared_folder_ids

router = APIRouter(prefix="/api/drive", tags=["Drive"])


@router.get("/files", response_model=list[FileResponse])
async def all_files(
    folder_id: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    query: dict = {"owner_id": current_user["_id"], "is_deleted": {"$ne": True}}
    if folder_id is not None:
        query["folder_id"] = parse_object_id(folder_id, "Invalid folder id")
    docs = await db.files.find(query).sort("updated_at", -1).to_list(500)
    return [serialize_file(item) for item in docs]


@router.get("/recent", response_model=list[FileResponse])
async def recent_files(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    docs = await db.files.find({"owner_id": current_user["_id"], "is_deleted": {"$ne": True}}).sort("updated_at", -1).to_list(20)
    return [serialize_file(item) for item in docs]


@router.get("/starred", response_model=list[FileResponse])
async def starred_files(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    docs = await db.files.find({"owner_id": current_user["_id"], "is_deleted": {"$ne": True}, "is_starred": True}).sort("updated_at", -1).to_list(500)
    return [serialize_file(item) for item in docs]


@router.get("/bin", response_model=list[FileResponse])
async def bin_files(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    docs = await db.files.find({"owner_id": current_user["_id"], "is_deleted": True}).sort("updated_at", -1).to_list(500)
    return [serialize_file(item) for item in docs]


@router.get("/shared", response_model=list[FileResponse])
async def shared_files(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    now = datetime.utcnow()
    links = await db.shared_files.find(
        {
            "shared_with_user_id": current_user["_id"],
            "$or": [
                {"share_expiry": None},
                {"share_expiry": {"$gt": now}},
                {"share_expiry": {"$exists": False}},
            ],
        }
    ).to_list(500)
    legacy_file_ids = [item["file_id"] for item in links]

    direct_docs = await db.files.find(
        {
            "owner_id": {"$ne": current_user["_id"]},
            "is_deleted": {"$ne": True},
            **build_active_file_share_query(current_user["_id"]),
        }
    ).to_list(500)

    shared_folder_ids = await get_accessible_shared_folder_ids(db, current_user["_id"])

    folder_file_docs = []
    if shared_folder_ids:
        folder_file_docs = await db.files.find(
            {
                "folder_id": {"$in": shared_folder_ids},
                "owner_id": {"$ne": current_user["_id"]},
                "is_deleted": {"$ne": True},
            }
        ).to_list(1000)

    legacy_docs = []
    if legacy_file_ids:
        legacy_docs = await db.files.find({"_id": {"$in": legacy_file_ids}, "is_deleted": {"$ne": True}}).to_list(500)

    docs_by_id = {
        str(item["_id"]): item
        for item in [*legacy_docs, *direct_docs, *folder_file_docs]
    }
    return [serialize_file(item) for item in docs_by_id.values()]


@router.patch("/{file_id}/star", response_model=FileResponse)
async def star_unstar(
    file_id: str,
    payload: StarFileRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    await db.files.update_one(
        {"_id": parsed_id, "owner_id": current_user["_id"]},
        {"$set": {"is_starred": payload.is_starred, "updated_at": datetime.utcnow()}},
    )
    doc = await db.files.find_one({"_id": parsed_id, "owner_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return serialize_file(doc)


@router.patch("/{file_id}/move", response_model=FileResponse)
async def move_file(
    file_id: str,
    payload: MoveFileRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    parsed_file_id = parse_object_id(file_id, "Invalid file id")
    parsed_folder_id = parse_object_id(payload.folder_id, "Invalid folder id") if payload.folder_id else None
    if parsed_folder_id:
        folder = await db.folders.find_one({"_id": parsed_folder_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}})
        if not folder:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    await db.files.update_one(
        {"_id": parsed_file_id, "owner_id": current_user["_id"]},
        {"$set": {"folder_id": parsed_folder_id, "updated_at": datetime.utcnow()}},
    )
    doc = await db.files.find_one({"_id": parsed_file_id, "owner_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return serialize_file(doc)


@router.post("/{file_id}/share-user", response_model=MessageResponse)
async def share_user(
    file_id: str,
    payload: ShareFileRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    parsed_file_id = parse_object_id(file_id, "Invalid file id")
    target_user_id = parse_object_id(payload.shared_with_user_id, "Invalid target user id")
    file_doc = await db.files.find_one({"_id": parsed_file_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}})
    if not file_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    target = await db.users.find_one({"_id": target_user_id})
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    now = datetime.utcnow()
    await db.files.update_one(
        {"_id": parsed_file_id, "owner_id": current_user["_id"]},
        {
            "$pull": {"share_entries": {"user_id": target_user_id}},
            "$addToSet": {"shared_with": target_user_id},
            "$set": {"updated_at": now},
        },
    )
    await db.files.update_one(
        {"_id": parsed_file_id, "owner_id": current_user["_id"]},
        {
            "$push": {
                "share_entries": {
                    "user_id": target_user_id,
                    "permission": "write" if payload.permission == "edit" else "read",
                    "expires_at": None,
                    "shared_at": now,
                }
            }
        },
    )
    await db.shared_files.update_one(
        {
            "file_id": parsed_file_id,
            "shared_with_user_id": target_user_id,
        },
        {
            "$set": {
                "shared_by_user_id": current_user["_id"],
                "permission": payload.permission,
                "updated_at": now,
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
    )
    return MessageResponse(message="File shared successfully")


