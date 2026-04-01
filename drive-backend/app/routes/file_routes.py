from __future__ import annotations
import os
import tempfile
from datetime import datetime
from pathlib import Path
from uuid import uuid4
import logging

from fastapi import APIRouter, Body, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse as FastAPIFileResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError
from starlette.background import BackgroundTask

import app.config as config
from app.database.mongodb import get_database
from app.routes.deps import get_current_user, get_optional_current_user
from app.routes.serializers import serialize_file, serialize_file_version
from app.schemas.common_schema import MessageResponse
from app.schemas.file_schema import (
    DownloadZipRequest,
    FileResponse,
    FileVersionResponse,
    MoveFileRequest,
    RenameRequest,
    RestoreVersionRequest,
)
from app.services.file_document_service import (
    build_file_document,
    build_file_version_entry,
    build_storage_usage_pipeline,
    iter_file_asset_keys,
    normalize_mime_type,
    normalize_file_name,
    normalize_file_versions,
)
from app.services.s3_service import S3Service
from app.services.tagging_service import generate_file_tags
from app.utils.access_control import ensure_file_access, ensure_file_write_access, ensure_folder_write_access
from app.utils.mongo_helpers import parse_object_id
from app.utils.query_helpers import build_accessible_file_query
from app.utils.jwt_handler import decode_token
from app.utils.storage import ensure_storage_capacity, sync_user_storage_usage

try:
    import zipfile36 as zipfile
except ImportError:
    import zipfile

router = APIRouter(prefix="/api/files", tags=["Files"])
s3_service = S3Service()
logger = logging.getLogger(__name__)


class DirectUploadUrlRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    folder_id: str | None = None


class CompleteDirectUploadRequest(BaseModel):
    filename: str
    key: str
    file_url: str | None = None
    mime_type: str = "application/octet-stream"
    file_size: int = 0
    folder_id: str | None = None


class MultipartStartRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    folder_id: str | None = None
    file_size: int = 0
    total_parts: int = 0


class MultipartPartUrlRequest(BaseModel):
    upload_id: str
    key: str
    part_number: int = Field(ge=1)


class MultipartPartAckRequest(BaseModel):
    upload_id: str
    key: str
    part_number: int = Field(ge=1)
    etag: str


class MultipartCompleteRequest(BaseModel):
    upload_id: str
    key: str
    filename: str
    mime_type: str = "application/octet-stream"
    file_size: int = 0
    folder_id: str | None = None
    parts: list[dict] = Field(default_factory=list)


class ShareLinkRequest(BaseModel):
    is_public: bool = True
    expires_at: datetime | None = None
    permission: str = "viewer"


async def _validate_upload(file: UploadFile) -> tuple[bytes, int]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty")
    max_bytes = config.MAX_FILE_SIZE_MB * 1024 * 1024
    file_size = len(content)
    if file_size > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"File exceeds {config.MAX_FILE_SIZE_MB}MB")
    await file.seek(0)
    return content, file_size


async def _log_activity(
    db: AsyncIOMotorDatabase,
    user_id,
    action: str,
    file_id=None,
    metadata: dict | None = None,
) -> None:
    await db.activity_logs.insert_one(
        {
            "user_id": user_id,
            "action": action,
            "file_id": file_id,
            "metadata": metadata or {},
            "timestamp": datetime.utcnow(),
        }
    )


async def _recalc_storage(db: AsyncIOMotorDatabase, owner_id) -> None:
    pipeline = build_storage_usage_pipeline(owner_id)
    data = await db.files.aggregate(pipeline).to_list(length=1)
    used = int(data[0]["used"]) if data else 0
    user = await db.users.find_one({"_id": owner_id}, {"storage_used": 1, "storage_limit": 1})
    if user:
        await sync_user_storage_usage(db, user, used)


async def _try_get_current_user_from_authorization(
    authorization: str | None,
    db: AsyncIOMotorDatabase,
) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except Exception:
        return None

    if payload.get("type") != "access":
        return None

    if payload.get("jti"):
        revoked = await db.token_blacklist.find_one({"jti": payload["jti"]})
        if revoked:
            return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    try:
        parsed_user_id = parse_object_id(user_id, "Invalid user id in token")
    except HTTPException:
        return None

    user = await db.users.find_one({"_id": parsed_user_id})
    if not user or not user.get("is_active", False):
        return None
    return user


def _resolve_file_url(request: Request, storage_path: str | None) -> str:
    file_url = storage_path or ""
    if file_url and not str(file_url).startswith(("http://", "https://", "mock://")):
        if str(file_url).startswith("/uploads/"):
            file_url = f"{str(request.base_url).rstrip('/')}/{file_url.lstrip('/')}"
        elif config.AWS_S3_BUCKET:
            file_url = f"https://{config.AWS_S3_BUCKET}.s3.{config.AWS_REGION}.amazonaws.com/{file_url}"
        else:
            file_url = f"{str(request.base_url).rstrip('/')}/{file_url.lstrip('/')}"
    return file_url


async def _find_existing_live_file(
    db: AsyncIOMotorDatabase,
    *,
    owner_id,
    folder_id,
    filename: str,
) -> dict | None:
    safe_filename = normalize_file_name(filename)
    docs = await db.files.find(
        {
            "owner_id": owner_id,
            "folder_id": folder_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {"file_name": safe_filename},
                {"filename": safe_filename},
            ],
        }
    ).sort("updated_at", -1).to_list(length=1)
    return docs[0] if docs else None


async def _create_or_version_file(
    db: AsyncIOMotorDatabase,
    *,
    filename: str,
    mime_type: str,
    file_size: int,
    owner_id,
    folder_id,
    file_url: str,
    thumbnail_url: str | None = None,
    s3_key: str | None = None,
) -> dict:
    safe_filename = normalize_file_name(filename)
    safe_mime_type = normalize_mime_type(mime_type, safe_filename)
    existing = await _find_existing_live_file(
        db,
        owner_id=owner_id,
        folder_id=folder_id,
        filename=filename,
    )
    if not existing:
        result = await db.files.insert_one(
            build_file_document(
                filename=safe_filename,
                mime_type=safe_mime_type,
                file_size=file_size,
                owner_id=owner_id,
                folder_id=folder_id,
                file_url=file_url,
                thumbnail_url=thumbnail_url,
                s3_key=s3_key,
            )
        )
        created = await db.files.find_one({"_id": result.inserted_id})
        assert created
        return created

    previous_versions = normalize_file_versions(existing.get("versions"))
    next_versions = [build_file_version_entry(existing), *previous_versions]
    now = datetime.utcnow()
    await db.files.update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "file_name": safe_filename,
                "filename": safe_filename,
                "file_size": max(int(file_size or 0), 0),
                "size": max(int(file_size or 0), 0),
                "file_type": safe_mime_type,
                "mime_type": safe_mime_type,
                "storage_path": file_url,
                "file_url": file_url,
                "thumbnail_url": thumbnail_url,
                "s3_key": s3_key,
                "tags": generate_file_tags(safe_filename, safe_mime_type),
                "versions": next_versions,
                "updated_at": now,
            }
        },
    )
    updated = await db.files.find_one({"_id": existing["_id"]})
    assert updated
    return updated


def _build_zip_entry_name(file_doc: dict, used_names: set[str]) -> str:
    original_name = normalize_file_name(file_doc.get("file_name") or file_doc.get("filename"))
    stem = Path(original_name).stem or "file"
    suffix = Path(original_name).suffix
    candidate = original_name
    counter = 1
    while candidate in used_names:
        candidate = f"{stem} ({counter}){suffix}"
        counter += 1
    used_names.add(candidate)
    return candidate


def _iter_body_chunks(body, chunk_size: int = 64 * 1024):
    if hasattr(body, "iter_chunks"):
        yield from body.iter_chunks(chunk_size)
        return

    while True:
        chunk = body.read(chunk_size)
        if not chunk:
            break
        yield chunk


async def _delete_file_assets(file_doc: dict) -> None:
    for asset_key in iter_file_asset_keys(file_doc):
        await s3_service.delete_object(asset_key)


def _cleanup_temp_file(path: str) -> None:
    if path and os.path.exists(path):
        os.unlink(path)


def _build_search_type_query(file_type: str | None) -> dict | None:
    normalized = (file_type or "").strip().lower()
    if not normalized:
        return None
    if normalized == "image":
        return {"mime_type": {"$regex": "^image/", "$options": "i"}}
    if normalized == "video":
        return {"mime_type": {"$regex": "^video/", "$options": "i"}}
    if normalized == "pdf":
        return {
            "$or": [
                {"mime_type": {"$regex": "pdf", "$options": "i"}},
                {"file_type": {"$regex": "pdf", "$options": "i"}},
                {"file_name": {"$regex": "\\.pdf$", "$options": "i"}},
            ]
        }
    if normalized == "text":
        return {"mime_type": {"$regex": "^text/", "$options": "i"}}
    return {"tags": {"$regex": normalized, "$options": "i"}}


def _normalize_optional_folder_id(value, detail: str = "Invalid folder id"):
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized or normalized.lower() in {"null", "undefined", "root", "drive", "my-drive"}:
            return None
        return parse_object_id(normalized, detail)
    return value


def _effective_file_mime_type(file_doc: dict | None, fallback_mime_type: str | None = None, fallback_filename: str | None = None) -> str:
    filename = (
        fallback_filename
        or (file_doc or {}).get("file_name")
        or (file_doc or {}).get("filename")
    )
    mime_type = fallback_mime_type
    if mime_type is None and file_doc:
        mime_type = file_doc.get("mime_type") or file_doc.get("file_type")
    return normalize_mime_type(mime_type, filename)


@router.post("/upload", response_model=FileResponse)
async def upload_file(
    file: UploadFile = File(...),
    folder_id: str | None = Form(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    file_url: str | None = None
    thumbnail_url: str | None = None

    try:
        if file is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file uploaded")

        filename = (file.filename or "").strip()
        if not filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Filename is required")

        logger.info(
            "Received upload request: filename=%s content_type=%s folder_id=%s user_id=%s",
            filename,
            file.content_type,
            folder_id,
            current_user.get("_id"),
        )

        content, file_size = await _validate_upload(file)
        if file_size <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty")

        await ensure_storage_capacity(db, current_user, file_size)

        parsed_folder_id = _normalize_optional_folder_id(folder_id, "Invalid folder id")
        if parsed_folder_id:
            folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
            await ensure_folder_write_access(db, folder, current_user)

        if config.AWS_S3_BUCKET:
            if not s3_service.bucket:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="S3 bucket is not configured",
                )
            if not s3_service.region:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="AWS region is not configured",
                )
            if not s3_service.credentials:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="AWS credentials are not configured",
                )

        safe_name = normalize_file_name(filename)
        effective_mime_type = _effective_file_mime_type(
            None,
            fallback_mime_type=file.content_type,
            fallback_filename=safe_name,
        )
        file_url = await s3_service.upload_bytes(
            content=content,
            content_type=effective_mime_type,
            filename=safe_name,
            owner_id=str(current_user["_id"]),
            folder_id=str(parsed_folder_id) if parsed_folder_id else None,
        )
        s3_key = None if s3_service.is_local_upload(file_url) else s3_service.extract_key(file_url)

        try:
            thumbnail_url = await s3_service.create_thumbnail(
                content=content,
                mime_type=effective_mime_type,
                owner_id=str(current_user["_id"]),
                folder_id=str(parsed_folder_id) if parsed_folder_id else None,
            )
        except Exception:
            logger.exception(
                "Thumbnail generation failed: filename=%s user_id=%s",
                filename,
                current_user.get("_id"),
            )
            thumbnail_url = None

        doc = await _create_or_version_file(
            db,
            filename=filename,
            mime_type=effective_mime_type,
            file_size=file_size,
            owner_id=current_user["_id"],
            folder_id=parsed_folder_id,
            file_url=file_url,
            thumbnail_url=thumbnail_url,
            s3_key=s3_key,
        )
        await _recalc_storage(db, current_user["_id"])
        await _log_activity(db, current_user["_id"], "upload", doc["_id"], {"source": "direct"})

        logger.info(
            "Upload completed: file_id=%s url=%s size_bytes=%s storage_mode=%s",
            doc["_id"],
            file_url,
            file_size,
            "local" if s3_service.is_local_upload(file_url) else "s3",
        )
        return serialize_file(doc)
    except HTTPException as exc:
        logger.warning(
            "Upload request failed: filename=%s user_id=%s status=%s detail=%s",
            getattr(file, "filename", None),
            current_user.get("_id"),
            exc.status_code,
            exc.detail,
        )
        raise
    except PyMongoError as exc:
        logger.exception(
            "Failed to persist uploaded file metadata: filename=%s user_id=%s",
            getattr(file, "filename", None),
            current_user.get("_id"),
        )
        if file_url:
            try:
                await s3_service.delete_object(file_url)
            except Exception:
                logger.exception("Failed to clean up uploaded file after metadata save error: file_url=%s", file_url)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File uploaded but metadata could not be saved",
        ) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected upload error: filename=%s user_id=%s",
            getattr(file, "filename", None),
            current_user.get("_id"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File upload failed",
        ) from exc


@router.post("/upload-folder", response_model=list[FileResponse])
async def upload_folder(
    folder_name: str = Form(...),
    files: list[UploadFile] = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    validated_uploads: list[tuple[UploadFile, bytes, int]] = []
    total_size = 0

    for upload in files:
        content, file_size = await _validate_upload(upload)
        validated_uploads.append((upload, content, file_size))
        total_size += file_size

    await ensure_storage_capacity(db, current_user, total_size)

    now = datetime.utcnow()
    try:
        folder_result = await db.folders.insert_one(
            {
                "name": folder_name,
                "owner_id": current_user["_id"],
                "parent_folder_id": None,
                "parent_folder": None,
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
        )
    except PyMongoError as exc:
        logger.exception("Failed to create folder for upload: folder_name=%s user_id=%s", folder_name, current_user.get("_id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Folder upload could not be initialized",
        ) from exc

    folder_id = folder_result.inserted_id
    response_items: list[FileResponse] = []
    for upload, content, file_size in validated_uploads:
        safe_name = normalize_file_name(upload.filename)
        effective_mime_type = _effective_file_mime_type(
            None,
            fallback_mime_type=upload.content_type,
            fallback_filename=safe_name,
        )
        try:
            file_url = await s3_service.upload_bytes(
                content=content,
                content_type=effective_mime_type,
                filename=safe_name,
                owner_id=str(current_user["_id"]),
                folder_id=str(folder_id),
            )
            s3_key = None if s3_service.is_local_upload(file_url) else s3_service.extract_key(file_url)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"File upload failed: {exc}") from exc
        thumbnail_url = await s3_service.create_thumbnail(
            content=content,
            mime_type=effective_mime_type,
            owner_id=str(current_user["_id"]),
            folder_id=str(folder_id),
        )
        try:
            inserted = await _create_or_version_file(
                db,
                filename=upload.filename or "unnamed",
                mime_type=effective_mime_type,
                file_size=file_size,
                owner_id=current_user["_id"],
                folder_id=folder_id,
                file_url=file_url,
                thumbnail_url=thumbnail_url,
                s3_key=s3_key,
            )
            await _log_activity(db, current_user["_id"], "upload", inserted["_id"], {"source": "folder_upload"})
        except PyMongoError as exc:
            logger.exception("Failed to persist folder upload metadata: filename=%s user_id=%s", upload.filename, current_user.get("_id"))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="File uploaded but metadata could not be saved",
            ) from exc
        response_items.append(serialize_file(inserted))
    try:
        await _recalc_storage(db, current_user["_id"])
    except PyMongoError as exc:
        logger.exception("Failed to recalculate storage after folder upload: user_id=%s", current_user.get("_id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Folder upload completed but storage usage could not be updated",
        ) from exc
    return response_items


@router.patch("/{file_id}/rename", response_model=FileResponse)
async def rename_file(
    file_id: str,
    payload: RenameRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    existing = await db.files.find_one({"_id": parsed_id, "is_deleted": {"$ne": True}})
    await ensure_file_write_access(db, existing, current_user)
    safe_name = normalize_file_name(payload.new_name)
    await db.files.update_one(
        {"_id": parsed_id},
        {
            "$set": {
                "file_name": safe_name,
                "filename": safe_name,
                "tags": generate_file_tags(safe_name, _effective_file_mime_type(existing, fallback_filename=safe_name)),
                "updated_at": datetime.utcnow(),
            }
        },
    )
    doc = await db.files.find_one({"_id": parsed_id})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    await _log_activity(db, current_user["_id"], "rename", parsed_id, {"new_name": payload.new_name})
    return serialize_file(doc)


@router.post("/get-upload-url", response_model=dict)
async def get_upload_url(
    payload: DirectUploadUrlRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_folder_id = _normalize_optional_folder_id(payload.folder_id, "Invalid folder id")
    if parsed_folder_id:
        folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
        await ensure_folder_write_access(db, folder, current_user)

    owner_id = str(current_user["_id"])
    effective_mime_type = _effective_file_mime_type(
        None,
        fallback_mime_type=payload.content_type,
        fallback_filename=payload.filename,
    )
    data = await s3_service.get_presigned_put_url(
        owner_id=owner_id,
        filename=payload.filename,
        content_type=effective_mime_type,
        folder_id=str(parsed_folder_id) if parsed_folder_id else None,
    )
    return data


@router.post("/complete-upload", response_model=FileResponse)
async def complete_direct_upload(
    payload: CompleteDirectUploadRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    await ensure_storage_capacity(db, current_user, max(int(payload.file_size or 0), 0))
    parsed_folder_id = _normalize_optional_folder_id(payload.folder_id, "Invalid folder id")
    if parsed_folder_id:
        folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
        await ensure_folder_write_access(db, folder, current_user)

    file_url = payload.file_url or (
        f"https://{config.AWS_S3_BUCKET}.s3.{config.AWS_REGION}.amazonaws.com/{payload.key}"
        if config.AWS_S3_BUCKET
        else payload.key
    )
    effective_mime_type = _effective_file_mime_type(
        None,
        fallback_mime_type=payload.mime_type,
        fallback_filename=payload.filename,
    )
    thumbnail_url = await s3_service.create_thumbnail_from_storage(
        storage_path=file_url,
        mime_type=effective_mime_type,
        owner_id=str(current_user["_id"]),
        folder_id=str(parsed_folder_id) if parsed_folder_id else None,
    )
    try:
        doc = await _create_or_version_file(
            db,
            filename=payload.filename or "unnamed",
            mime_type=effective_mime_type,
            file_size=max(int(payload.file_size or 0), 0),
            owner_id=current_user["_id"],
            folder_id=parsed_folder_id,
            file_url=file_url,
            thumbnail_url=thumbnail_url,
            s3_key=None if s3_service.is_local_upload(file_url) else payload.key,
        )
        await _recalc_storage(db, current_user["_id"])
        await _log_activity(db, current_user["_id"], "upload", doc["_id"], {"source": "presigned"})
    except PyMongoError as exc:
        logger.exception("Failed to persist presigned upload metadata: filename=%s user_id=%s", payload.filename, current_user.get("_id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Uploaded file metadata could not be saved",
        ) from exc
    logger.info("Presigned upload completed: user_id=%s key=%s", current_user.get("_id"), payload.key)
    return serialize_file(doc)


@router.post("/multipart/start", response_model=dict)
async def start_multipart_upload(
    payload: MultipartStartRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    await ensure_storage_capacity(db, current_user, max(int(payload.file_size or 0), 0))
    parsed_folder_id = _normalize_optional_folder_id(payload.folder_id, "Invalid folder id")
    if parsed_folder_id:
        folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
        await ensure_folder_write_access(db, folder, current_user)

    owner_id = str(current_user["_id"])
    effective_mime_type = _effective_file_mime_type(
        None,
        fallback_mime_type=payload.content_type,
        fallback_filename=payload.filename,
    )
    data = await s3_service.start_multipart_upload(
        owner_id=owner_id,
        filename=payload.filename,
        content_type=effective_mime_type,
        folder_id=str(parsed_folder_id) if parsed_folder_id else None,
    )

    try:
        await db.uploads.update_one(
            {"upload_id": data["upload_id"], "user_id": current_user["_id"]},
            {
                "$set": {
                    "file_name": payload.filename,
                    "key": data["key"],
                    "file_url": data["file_url"],
                    "mime_type": effective_mime_type,
                    "folder_id": parsed_folder_id,
                    "file_size": max(int(payload.file_size or 0), 0),
                    "total_parts": max(int(payload.total_parts or 0), 0),
                    "status": "in_progress",
                    "updated_at": datetime.utcnow(),
                },
                "$setOnInsert": {
                    "upload_id": data["upload_id"],
                    "uploaded_parts": [],
                    "user_id": current_user["_id"],
                    "created_at": datetime.utcnow(),
                },
            },
            upsert=True,
        )
    except PyMongoError as exc:
        logger.exception("Failed to persist multipart upload session: user_id=%s upload_id=%s", current_user.get("_id"), data.get("upload_id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Multipart upload session could not be saved",
        ) from exc
    logger.info("Multipart upload started: user_id=%s upload_id=%s key=%s", current_user.get("_id"), data.get("upload_id"), data.get("key"))
    return data


@router.get("/multipart/status/{upload_id}", response_model=dict)
async def multipart_upload_status(
    upload_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    doc = await db.uploads.find_one({"upload_id": upload_id, "user_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")
    return {
        "upload_id": doc["upload_id"],
        "file_name": doc.get("file_name"),
        "key": doc.get("key"),
        "file_url": doc.get("file_url"),
        "uploaded_parts": doc.get("uploaded_parts", []),
        "total_parts": doc.get("total_parts", 0),
        "status": doc.get("status", "in_progress"),
    }


@router.post("/multipart/upload-part", response_model=dict)
async def multipart_part_upload_url(
    payload: MultipartPartUrlRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    doc = await db.uploads.find_one({"upload_id": payload.upload_id, "user_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")
    url = await s3_service.get_multipart_part_url(
        key=payload.key,
        upload_id=payload.upload_id,
        part_number=payload.part_number,
    )
    return {
        "upload_id": payload.upload_id,
        "part_number": payload.part_number,
        "upload_url": url,
    }


@router.post("/multipart/ack-part", response_model=dict)
async def multipart_ack_part(
    payload: MultipartPartAckRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    doc = await db.uploads.find_one({"upload_id": payload.upload_id, "user_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")

    uploaded_parts = doc.get("uploaded_parts", [])
    uploaded_parts = [item for item in uploaded_parts if int(item.get("PartNumber", 0)) != payload.part_number]
    uploaded_parts.append({"PartNumber": payload.part_number, "ETag": payload.etag})
    uploaded_parts.sort(key=lambda item: int(item["PartNumber"]))

    try:
        await db.uploads.update_one(
            {"upload_id": payload.upload_id, "user_id": current_user["_id"]},
            {"$set": {"uploaded_parts": uploaded_parts, "updated_at": datetime.utcnow()}},
        )
    except PyMongoError as exc:
        logger.exception("Failed to persist multipart upload progress: user_id=%s upload_id=%s", current_user.get("_id"), payload.upload_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Multipart upload progress could not be saved",
        ) from exc
    return {"upload_id": payload.upload_id, "uploaded_parts": uploaded_parts}


@router.post("/multipart/complete", response_model=FileResponse)
async def complete_multipart_upload(
    payload: MultipartCompleteRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    doc = await db.uploads.find_one({"upload_id": payload.upload_id, "user_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")

    final_size = max(int(payload.file_size or doc.get("file_size", 0) or 0), 0)
    await ensure_storage_capacity(db, current_user, final_size)

    parsed_folder_id = _normalize_optional_folder_id(
        payload.folder_id if payload.folder_id is not None else doc.get("folder_id"),
        "Invalid folder id",
    )
    if parsed_folder_id:
        folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
        await ensure_folder_write_access(db, folder, current_user)

    parts = payload.parts or doc.get("uploaded_parts", [])
    if not parts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No uploaded parts to complete")

    file_url = await s3_service.complete_multipart_upload(
        key=payload.key,
        upload_id=payload.upload_id,
        parts=parts,
    )
    filename = payload.filename or doc.get("file_name") or "unnamed"
    effective_mime_type = _effective_file_mime_type(
        None,
        fallback_mime_type=payload.mime_type or doc.get("mime_type"),
        fallback_filename=filename,
    )
    thumbnail_url = await s3_service.create_thumbnail_from_storage(
        storage_path=file_url,
        mime_type=effective_mime_type,
        owner_id=str(current_user["_id"]),
        folder_id=str(parsed_folder_id) if parsed_folder_id else None,
    )
    try:
        file_doc = await _create_or_version_file(
            db,
            filename=filename,
            mime_type=effective_mime_type,
            file_size=final_size,
            owner_id=current_user["_id"],
            folder_id=parsed_folder_id,
            file_url=file_url,
            thumbnail_url=thumbnail_url,
            s3_key=None if s3_service.is_local_upload(file_url) else payload.key,
        )
        await db.uploads.update_one(
            {"upload_id": payload.upload_id, "user_id": current_user["_id"]},
            {"$set": {"status": "completed", "updated_at": datetime.utcnow()}},
        )
        await _recalc_storage(db, current_user["_id"])
        await _log_activity(db, current_user["_id"], "upload", file_doc["_id"], {"source": "multipart"})
    except PyMongoError as exc:
        logger.exception("Failed to finalize multipart upload metadata: user_id=%s upload_id=%s", current_user.get("_id"), payload.upload_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Multipart upload finished but metadata could not be saved",
        ) from exc
    logger.info("Multipart upload completed: user_id=%s upload_id=%s key=%s", current_user.get("_id"), payload.upload_id, payload.key)
    return serialize_file(file_doc)


@router.post("/{file_id}/share", response_model=dict)
async def create_share_link(
    file_id: str,
    payload: ShareLinkRequest = Body(default=ShareLinkRequest()),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_file_id = parse_object_id(file_id, "Invalid file id")
    file_doc = await db.files.find_one({"_id": parsed_file_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}})
    if not file_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    token = uuid4().hex
    await db.shares.insert_one(
        {
            "file_id": parsed_file_id,
            "share_token": token,
            "is_public": bool(payload.is_public),
            "expires_at": payload.expires_at,
            "permission": payload.permission if payload.permission in ("viewer", "editor") else "viewer",
            "owner_id": current_user["_id"],
            "created_at": datetime.utcnow(),
        }
    )
    await db.files.update_one(
        {"_id": parsed_file_id, "owner_id": current_user["_id"]},
        {"$set": {"is_public": bool(payload.is_public), "updated_at": datetime.utcnow()}},
    )
    await _log_activity(db, current_user["_id"], "share", parsed_file_id, {"share_token": token})
    frontend_base = config.CORS_ORIGINS[0] if config.CORS_ORIGINS else "http://localhost:5173"
    return {
        "share_token": token,
        "share_url": f"{frontend_base.rstrip('/')}/share/{token}",
        "api_share_url": f"/api/files/share/{token}",
        "is_public": bool(payload.is_public),
        "permission": payload.permission if payload.permission in ("viewer", "editor") else "viewer",
        "expires_at": payload.expires_at,
    }


@router.get("/share/{token}", response_model=dict)
async def get_shared_file(
    token: str,
    authorization: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    share_doc = await db.shares.find_one({"share_token": token})
    if not share_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    expires_at = share_doc.get("expires_at")
    if expires_at and expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link expired")

    if not share_doc.get("is_public", True):
        current_user = await _try_get_current_user_from_authorization(authorization, db)
        if not current_user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This link requires sign-in before it can be opened",
            )

    file_doc = await db.files.find_one({"_id": share_doc["file_id"], "is_deleted": {"$ne": True}})
    if not file_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    mime_type = _effective_file_mime_type(file_doc)

    return {
        "id": str(file_doc["_id"]),
        "name": file_doc.get("filename") or file_doc.get("file_name") or "File",
        "file_url": file_doc.get("file_url") or file_doc.get("storage_path"),
        "mime_type": mime_type,
        "size": file_doc.get("size") or file_doc.get("file_size") or 0,
        "permission": share_doc.get("permission", "viewer"),
        "is_public": share_doc.get("is_public", True),
        "expires_at": expires_at,
        "preview_url": file_doc.get("file_url") or file_doc.get("storage_path"),
        "thumbnail_url": file_doc.get("thumbnail_url"),
    }


@router.get("/search", response_model=list[FileResponse])
async def search_files(
    q: str = Query(default=""),
    file_type: str | None = Query(default=None, alias="type"),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    query_text = (q or "").strip()
    created_filter: dict | None = None
    if date_from or date_to:
        created_filter = {"created_at": {}}
        if date_from:
            created_filter["created_at"]["$gte"] = date_from
        if date_to:
            created_filter["created_at"]["$lte"] = date_to

    docs = await db.files.find(
        await build_accessible_file_query(
            db,
            current_user["_id"],
            {
                "$or": [
                    {"file_name": {"$regex": query_text, "$options": "i"}},
                    {"filename": {"$regex": query_text, "$options": "i"}},
                    {"tags": {"$regex": query_text, "$options": "i"}},
                ]
            } if query_text else None,
            _build_search_type_query(file_type),
            created_filter,
        )
    ).sort("updated_at", -1).to_list(200)
    return [serialize_file(item) for item in docs]


@router.get("/{file_id}/versions", response_model=list[FileVersionResponse])
async def get_file_versions(
    file_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileVersionResponse]:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    doc = await db.files.find_one({"_id": parsed_id, "is_deleted": {"$ne": True}})
    await ensure_file_access(db, doc, current_user)

    versions = normalize_file_versions(doc.get("versions"))
    if versions != doc.get("versions", []):
        await db.files.update_one({"_id": parsed_id}, {"$set": {"versions": versions, "updated_at": doc.get("updated_at", datetime.utcnow())}})

    versions.sort(key=lambda item: item.get("created_at") or datetime.min, reverse=True)
    return [serialize_file_version(item) for item in versions]


@router.post("/{file_id}/restore-version", response_model=FileResponse)
async def restore_file_version(
    file_id: str,
    payload: RestoreVersionRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    doc = await db.files.find_one({"_id": parsed_id, "is_deleted": {"$ne": True}})
    await ensure_file_write_access(db, doc, current_user)

    versions = normalize_file_versions(doc.get("versions"))
    if not versions:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No previous versions found")

    restore_index: int | None = None
    if payload.version_id:
        restore_index = next((index for index, version in enumerate(versions) if version.get("id") == payload.version_id), None)
    elif payload.version_index is not None:
        restore_index = payload.version_index

    if restore_index is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide version_id or version_index")
    if restore_index < 0 or restore_index >= len(versions):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")

    selected_version = versions.pop(restore_index)
    current_version = build_file_version_entry(doc)
    safe_name = normalize_file_name(selected_version.get("file_name") or selected_version.get("filename"))
    mime_type = _effective_file_mime_type(
        None,
        fallback_mime_type=selected_version.get("mime_type") or selected_version.get("file_type"),
        fallback_filename=safe_name,
    )

    await db.files.update_one(
        {"_id": parsed_id},
        {
            "$set": {
                "file_name": safe_name,
                "filename": safe_name,
                "file_size": max(int(selected_version.get("file_size") or selected_version.get("size") or 0), 0),
                "size": max(int(selected_version.get("size") or selected_version.get("file_size") or 0), 0),
                "file_type": mime_type,
                "mime_type": mime_type,
                "storage_path": selected_version.get("storage_path") or selected_version.get("file_url") or "",
                "file_url": selected_version.get("file_url") or selected_version.get("storage_path") or "",
                "thumbnail_url": selected_version.get("thumbnail_url"),
                "s3_key": selected_version.get("s3_key"),
                "tags": list(selected_version.get("tags") or generate_file_tags(safe_name, mime_type)),
                "versions": [current_version, *versions],
                "updated_at": datetime.utcnow(),
            }
        },
    )
    updated = await db.files.find_one({"_id": parsed_id})
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    await _log_activity(db, current_user["_id"], "restore_version", parsed_id, {"version_id": selected_version.get("id")})
    await _recalc_storage(db, current_user["_id"])
    return serialize_file(updated)


@router.post("/download-zip")
async def download_files_as_zip(
    payload: DownloadZipRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    parsed_ids: list = []
    seen_ids: set[str] = set()
    for file_id in payload.file_ids:
        parsed_id = parse_object_id(file_id, "Invalid file id")
        marker = str(parsed_id)
        if marker in seen_ids:
            continue
        seen_ids.add(marker)
        parsed_ids.append(parsed_id)

    if not parsed_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files selected")

    query = await build_accessible_file_query(
        db,
        current_user["_id"],
        {"_id": {"$in": parsed_ids}},
    )
    docs = await db.files.find(query).to_list(length=len(parsed_ids))
    docs_by_id = {doc["_id"]: doc for doc in docs}

    if len(docs_by_id) != len(parsed_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more files were not found")

    tmp_file = tempfile.NamedTemporaryFile(prefix="drive-download-", suffix=".zip", delete=False)
    tmp_path = tmp_file.name
    tmp_file.close()

    try:
        with zipfile.ZipFile(tmp_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            used_names: set[str] = set()
            for parsed_id in parsed_ids:
                file_doc = docs_by_id[parsed_id]
                archive_name = _build_zip_entry_name(file_doc, used_names)
                object_path = file_doc.get("s3_key") or file_doc.get("file_url") or file_doc.get("storage_path")
                if not object_path:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f'Missing storage path for "{archive_name}"')

                storage_object = await s3_service.get_object(object_path)
                body = storage_object["Body"]
                try:
                    with archive.open(archive_name, "w") as archive_handle:
                        for chunk in _iter_body_chunks(body):
                            if chunk:
                                archive_handle.write(chunk)
                finally:
                    if hasattr(body, "close"):
                        body.close()

                await _log_activity(db, current_user["_id"], "download", file_doc["_id"], {"source": "zip"})

        filename = f"drive-files-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.zip"
        return FastAPIFileResponse(
            path=tmp_path,
            media_type="application/zip",
            filename=filename,
            background=BackgroundTask(_cleanup_temp_file, tmp_path),
        )
    except Exception as exc:
        _cleanup_temp_file(tmp_path)
        if isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"ZIP download failed: {exc}") from exc


@router.get("/{file_id}", response_model=dict)
async def get_file_metadata(
    file_id: str,
    request: Request,
    current_user: dict | None = Depends(get_optional_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    doc = await db.files.find_one({"_id": parsed_id, "is_deleted": {"$ne": True}})
    await ensure_file_access(db, doc, current_user)

    file_url = _resolve_file_url(request, doc.get("file_url") or doc.get("storage_path"))
    mime_type = _effective_file_mime_type(doc)
    return {
        "id": str(doc["_id"]),
        "name": doc.get("filename") or doc.get("file_name") or "File",
        "size": doc.get("size") or doc.get("file_size") or 0,
        "type": mime_type,
        "url": file_url,
        "mime_type": mime_type,
        "preview_url": file_url,
        "stream_url": f"{str(request.base_url).rstrip('/')}/api/files/{file_id}/stream",
        "thumbnail_url": doc.get("thumbnail_url"),
        "version_count": len(doc.get("versions", [])),
    }


@router.get("/{file_id}/stream")
async def stream_file(
    file_id: str,
    request: Request,
    current_user: dict | None = Depends(get_optional_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    parsed_id = parse_object_id(file_id, "Invalid file id")
    doc = await db.files.find_one({"_id": parsed_id, "is_deleted": {"$ne": True}})
    await ensure_file_access(db, doc, current_user)

    key_or_url = doc.get("s3_key") or doc.get("file_url") or doc.get("storage_path")
    if not key_or_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File storage path not found")

    range_header = request.headers.get("range")
    s3_response = await s3_service.get_object(key_or_url, range_header=range_header)
    body = s3_response["Body"]
    content_type = _effective_file_mime_type(doc, fallback_mime_type=s3_response.get("ContentType"))
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": content_type,
    }
    if "ContentRange" in s3_response:
        headers["Content-Range"] = s3_response["ContentRange"]
    if "ContentLength" in s3_response:
        headers["Content-Length"] = str(s3_response["ContentLength"])

    status_code = status.HTTP_206_PARTIAL_CONTENT if range_header else status.HTTP_200_OK
    if current_user:
        await _log_activity(db, current_user["_id"], "download", parsed_id, {"range": bool(range_header)})
    return StreamingResponse(body.iter_chunks(), status_code=status_code, headers=headers)


@router.delete("/{file_id}", response_model=MessageResponse)
async def delete_file(
    file_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    result = await db.files.update_one(
        {"_id": parsed_id, "owner_id": current_user["_id"], "is_deleted": {"$ne": True}},
        {"$set": {"is_deleted": True, "deleted_at": datetime.utcnow(), "updated_at": datetime.utcnow()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    await _recalc_storage(db, current_user["_id"])
    await _log_activity(db, current_user["_id"], "delete", parsed_id)
    return MessageResponse(message="File moved to bin")


@router.post("/{file_id}/restore", response_model=FileResponse)
async def restore_file(
    file_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    await db.files.update_one(
        {"_id": parsed_id, "owner_id": current_user["_id"]},
        {"$set": {"is_deleted": False, "deleted_at": None, "updated_at": datetime.utcnow()}},
    )
    doc = await db.files.find_one({"_id": parsed_id, "owner_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    await _recalc_storage(db, current_user["_id"])
    return serialize_file(doc)


@router.delete("/{file_id}/permanent", response_model=MessageResponse)
async def permanently_delete_file(
    file_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    doc = await db.files.find_one({"_id": parsed_id, "owner_id": current_user["_id"]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    await _delete_file_assets(doc)
    await db.files.delete_one({"_id": parsed_id, "owner_id": current_user["_id"]})
    await _recalc_storage(db, current_user["_id"])
    await _log_activity(db, current_user["_id"], "delete", parsed_id, {"permanent": True})
    return MessageResponse(message="File permanently deleted")


@router.patch("/{file_id}/move", response_model=FileResponse)
async def move_file(
    file_id: str,
    payload: MoveFileRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> FileResponse:
    parsed_file_id = parse_object_id(file_id, "Invalid file id")
    existing = await db.files.find_one({"_id": parsed_file_id, "is_deleted": {"$ne": True}})
    await ensure_file_write_access(db, existing, current_user)
    parsed_folder_id = parse_object_id(payload.folder_id, "Invalid folder id") if payload.folder_id else None
    if parsed_folder_id:
        folder = await db.folders.find_one({"_id": parsed_folder_id, "is_deleted": {"$ne": True}})
        await ensure_folder_write_access(db, folder, current_user)
    await db.files.update_one(
        {"_id": parsed_file_id},
        {"$set": {"folder_id": parsed_folder_id, "updated_at": datetime.utcnow()}},
    )
    doc = await db.files.find_one({"_id": parsed_file_id})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    await _log_activity(db, current_user["_id"], "move", parsed_file_id, {"folder_id": str(parsed_folder_id) if parsed_folder_id else None})
    return serialize_file(doc)


@router.get("/{file_id}/preview", response_model=dict)
async def preview_file(
    file_id: str,
    request: Request,
    current_user: dict | None = Depends(get_optional_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    parsed_id = parse_object_id(file_id, "Invalid file id")
    doc = await db.files.find_one({"_id": parsed_id, "is_deleted": {"$ne": True}})
    await ensure_file_access(db, doc, current_user)

    file_url = _resolve_file_url(request, doc.get("file_url") or doc.get("storage_path"))
    mime_type = _effective_file_mime_type(doc)

    return {
        "file_url": file_url,
        "preview_url": file_url,
        "stream_url": f"{str(request.base_url).rstrip('/')}/api/files/{file_id}/stream",
        "thumbnail_url": doc.get("thumbnail_url"),
        "mime_type": mime_type,
        "name": doc.get("filename") or doc.get("file_name") or "File",
        "size": doc.get("size") or doc.get("file_size"),
        "tags": doc.get("tags", []),
        "version_count": len(doc.get("versions", [])),
    }


