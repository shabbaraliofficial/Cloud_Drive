from __future__ import annotations
from datetime import datetime
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import PyMongoError

from app.core import config
from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.routes.serializers import serialize_file, serialize_folder
from app.schemas.storage_schema import StorageUsageResponse
from app.services.file_document_service import build_file_document, build_storage_usage_pipeline
from app.services.s3_service import S3Service
from app.utils.access_control import ensure_folder_access, ensure_folder_write_access
from app.utils.mongo_helpers import parse_object_id
from app.utils.storage import ensure_storage_capacity, sync_user_storage_usage

router = APIRouter(prefix="/api/storage", tags=["Storage"])
s3_service = S3Service()
logger = logging.getLogger(__name__)


async def _get_usage(db: AsyncIOMotorDatabase, user: dict) -> dict:
    pipeline = build_storage_usage_pipeline(user["_id"])
    data = await db.files.aggregate(pipeline).to_list(length=1)
    used = int(data[0]["used"]) if data else 0
    return await sync_user_storage_usage(db, user, used)


async def _validate_upload(file: UploadFile) -> bytes:
    if file.content_type not in config.ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty")
    max_bytes = config.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"File exceeds {config.MAX_FILE_SIZE_MB}MB")
    return content


@router.post("/upload", response_model=dict)
async def upload_to_storage(
    file: UploadFile = File(...),
    folder_id: str | None = Form(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    content = await _validate_upload(file)
    await ensure_storage_capacity(db, current_user, len(content))
    parsed_folder_id = parse_object_id(folder_id, "Invalid folder id") if folder_id else None

    if parsed_folder_id:
        folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
        await ensure_folder_write_access(db, folder, current_user)

    try:
        file_url = await s3_service.upload_bytes(
            content=content,
            content_type=file.content_type or "application/octet-stream",
            filename=file.filename or "unnamed",
            owner_id=str(current_user["_id"]),
            folder_id=str(parsed_folder_id) if parsed_folder_id else None,
        )
    except Exception as exc:
        logger.exception("Storage upload failed: filename=%s user_id=%s", file.filename, current_user.get("_id"))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"S3 upload failed: {exc}") from exc

    try:
        result = await db.files.insert_one(
            build_file_document(
                filename=file.filename or "unnamed",
                mime_type=file.content_type or "application/octet-stream",
                file_size=len(content),
                owner_id=current_user["_id"],
                folder_id=parsed_folder_id,
                file_url=file_url,
            )
        )

        await _get_usage(db, current_user)
        doc = await db.files.find_one({"_id": result.inserted_id})
    except PyMongoError as exc:
        logger.exception("Failed to persist storage upload metadata: filename=%s user_id=%s", file.filename, current_user.get("_id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File uploaded but metadata could not be saved",
        ) from exc

    logger.info("Storage upload completed: filename=%s user_id=%s file_id=%s", file.filename, current_user.get("_id"), result.inserted_id)

    return {
        "id": str(result.inserted_id),
        "filename": file.filename or "unnamed",
        "file_url": file_url,
        "file": serialize_file(doc) if doc else None,
    }


@router.get("/usage", response_model=StorageUsageResponse)
async def storage_usage(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> StorageUsageResponse:
    data = await _get_usage(db, current_user)
    return StorageUsageResponse(**data)


@router.get("/available", response_model=dict[str, int])
async def available_storage(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict[str, int]:
    data = await _get_usage(db, current_user)
    return {"available_bytes": data["available_bytes"]}


@router.get("/folder/{folder_id}", response_model=dict)
async def folder_contents(
    folder_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_folder_id = parse_object_id(folder_id, "Invalid folder id")
    folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
    await ensure_folder_access(db, folder, current_user)

    owner_id = folder["owner_id"]

    folder_docs = await db.folders.find(
        {
            "owner_id": owner_id,
            "$or": [{"parent_folder_id": parsed_folder_id}, {"parent_folder": parsed_folder_id}],
            "is_deleted": {"$ne": True},
        }
    ).sort("updated_at", -1).to_list(500)
    file_docs = await db.files.find(
        {"owner_id": owner_id, "folder_id": parsed_folder_id, "is_deleted": {"$ne": True}}
    ).sort("updated_at", -1).to_list(500)

    return {
        "folders": [serialize_folder(item) for item in folder_docs],
        "files": [serialize_file(item) for item in file_docs],
    }


