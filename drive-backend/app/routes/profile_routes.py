from __future__ import annotations
from datetime import datetime
from io import BytesIO
import logging
import mimetypes
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import PyMongoError

from app.core import config
from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.services.s3_service import S3Service
from app.utils.password_handler import hash_password, verify_password
from app.utils.storage import build_storage_payload, ensure_user_storage_limit, sync_user_storage_usage

router = APIRouter(prefix="/api/profile", tags=["Profile"])
s3_service = S3Service()
logger = logging.getLogger(__name__)
LOCAL_PROFILE_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "profile"
LOCAL_PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class ProfileMeResponse(BaseModel):
    full_name: str
    username: str
    email: EmailStr
    profile_picture: str | None = None
    plan: str = "free"
    is_premium: bool = False
    storage_used: int
    storage_limit: int
    used: int
    total: int
    remaining: int
    account_type: str
    two_factor_enabled: bool = False
    last_login: datetime | None = None


class ProfileUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    username: str | None = Field(default=None, min_length=3, max_length=60)
    phone_number: str | None = Field(default=None, min_length=8, max_length=20)
    dob: str | None = None
    gender: str | None = Field(default=None, max_length=30)
    bio: str | None = Field(default=None, max_length=500)


class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=128)


class SecurityUpdateRequest(BaseModel):
    two_factor_enabled: bool


class SecurityUpdateResponse(BaseModel):
    two_factor_enabled: bool


class StorageInfoResponse(BaseModel):
    used: int
    total: int
    limit: int
    remaining: int
    file_count: int


class BackupDeviceEntry(BaseModel):
    name: str
    last_sync_at: datetime | None = None
    status: str = "Idle"


class BackupSettingsResponse(BaseModel):
    backup_enabled: bool = False
    devices: list[BackupDeviceEntry] = []


class BackupSettingsUpdateRequest(BaseModel):
    backup_enabled: bool
    device_name: str | None = Field(default=None, min_length=2, max_length=120)
    status: str | None = Field(default=None, max_length=80)
    last_sync_at: datetime | None = None


class MessageResponse(BaseModel):
    message: str


class ProfilePhotoResponse(BaseModel):
    profile_picture: str


def _guess_image_mime_type(filename: str | None) -> str | None:
    guessed_type, _ = mimetypes.guess_type(filename or "")
    if guessed_type and guessed_type.startswith("image/"):
        return guessed_type
    return None


def _resolve_profile_photo_content_type(file: UploadFile, content: bytes) -> str:
    declared_type = str(file.content_type or "").strip().lower()
    guessed_type = _guess_image_mime_type(file.filename)

    try:
        from PIL import Image  # type: ignore
    except Exception:
        if declared_type.startswith("image/"):
            return declared_type
        if guessed_type:
            return guessed_type
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only image uploads are allowed")

    try:
        with Image.open(BytesIO(content)) as image:
            detected_type = Image.MIME.get(image.format or "", "")
            image.verify()
    except Exception as exc:
        logger.warning(
            "Rejected non-image profile upload: filename=%s content_type=%s error=%s",
            getattr(file, "filename", None),
            getattr(file, "content_type", None),
            exc,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only image uploads are allowed") from exc

    detected_type = str(detected_type or "").strip().lower()
    if detected_type.startswith("image/"):
        return detected_type
    if declared_type.startswith("image/"):
        return declared_type
    if guessed_type:
        return guessed_type
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only image uploads are allowed")


def _resolve_profile_photo_suffix(filename: str | None, content_type: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix:
        return suffix
    guessed_suffix = mimetypes.guess_extension(content_type or "")
    if guessed_suffix == ".jpe":
        return ".jpg"
    return guessed_suffix or ".jpg"


def _to_photo_url(value: str | None, request: Request | None = None) -> str | None:
    if not value:
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return value
    path = value if value.startswith("/") else f"/{value}"
    if request is not None:
        base = str(request.base_url).rstrip("/")
        return f"{base}{path}"
    return path


def _defaults(user: dict) -> dict:
    return {
        "full_name": user.get("full_name") or user.get("username") or "User",
        "username": user.get("username") or "user",
        "profile_picture": user.get("profile_picture"),
        "phone_number": user.get("phone_number") or user.get("mobile_number"),
        "dob": user.get("dob") or user.get("date_of_birth"),
        "gender": user.get("gender"),
        "bio": user.get("bio"),
        "plan": user.get("plan") or "free",
        "is_premium": bool(user.get("is_premium", False)),
        "storage_used": int(user.get("storage_used", 0) or 0),
        "storage_limit": int(user.get("storage_limit", config.DEFAULT_STORAGE_QUOTA_BYTES) or config.DEFAULT_STORAGE_QUOTA_BYTES),
        "account_type": user.get("account_type") or "Free",
        "two_factor_enabled": bool(user.get("two_factor_enabled", user.get("is_2fa_enabled", False))),
        "last_login": user.get("last_login"),
        "backup_enabled": bool(user.get("backup_enabled", False)),
        "devices": list(user.get("devices", [])),
        "created_at": user.get("created_at", datetime.utcnow()),
    }


async def _ensure_profile_defaults(db: AsyncIOMotorDatabase, user: dict) -> dict:
    normalized_limit = await ensure_user_storage_limit(db, user)
    user["storage_limit"] = normalized_limit
    defaults = _defaults(user)
    missing_updates: dict = {}

    for key, value in defaults.items():
        if key not in user:
            missing_updates[key] = value

    if missing_updates:
        missing_updates["updated_at"] = datetime.utcnow()
        await db.users.update_one({"_id": user["_id"]}, {"$set": missing_updates})
        user = {**user, **missing_updates}

    return user


@router.get("/me", response_model=ProfileMeResponse)
async def get_my_profile(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> ProfileMeResponse:
    user = await _ensure_profile_defaults(db, current_user)
    storage = build_storage_payload(
        int(user.get("storage_used", 0) or 0),
        int(user.get("storage_limit", config.DEFAULT_STORAGE_QUOTA_BYTES) or config.DEFAULT_STORAGE_QUOTA_BYTES),
    )
    return ProfileMeResponse(
        full_name=user.get("full_name") or user.get("username") or "User",
        username=user.get("username") or "user",
        email=user["email"],
        profile_picture=_to_photo_url(user.get("profile_picture"), request),
        plan=user.get("plan") or "free",
        is_premium=bool(user.get("is_premium", False)),
        storage_used=storage["used"],
        storage_limit=storage["total"],
        used=storage["used"],
        total=storage["total"],
        remaining=storage["remaining"],
        account_type=user.get("account_type") or "Free",
        two_factor_enabled=bool(user.get("two_factor_enabled", user.get("is_2fa_enabled", False))),
        last_login=user.get("last_login"),
    )


@router.patch("/update", response_model=ProfileMeResponse)
async def update_profile(
    request: Request,
    payload: ProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> ProfileMeResponse:
    user = await _ensure_profile_defaults(db, current_user)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}

    if updates.get("username"):
        existing_username = await db.users.find_one(
            {"username": updates["username"], "_id": {"$ne": user["_id"]}}
        )
        if existing_username:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    if updates:
        updates["updated_at"] = datetime.utcnow()
        await db.users.update_one({"_id": user["_id"]}, {"$set": updates})

    refreshed = await db.users.find_one({"_id": user["_id"]})
    assert refreshed
    refreshed = await _ensure_profile_defaults(db, refreshed)
    storage = build_storage_payload(
        int(refreshed.get("storage_used", 0) or 0),
        int(refreshed.get("storage_limit", config.DEFAULT_STORAGE_QUOTA_BYTES) or config.DEFAULT_STORAGE_QUOTA_BYTES),
    )

    return ProfileMeResponse(
        full_name=refreshed.get("full_name") or refreshed.get("username") or "User",
        username=refreshed.get("username") or "user",
        email=refreshed["email"],
        profile_picture=_to_photo_url(refreshed.get("profile_picture"), request),
        plan=refreshed.get("plan") or "free",
        is_premium=bool(refreshed.get("is_premium", False)),
        storage_used=storage["used"],
        storage_limit=storage["total"],
        used=storage["used"],
        total=storage["total"],
        remaining=storage["remaining"],
        account_type=refreshed.get("account_type") or "Free",
        two_factor_enabled=bool(refreshed.get("two_factor_enabled", refreshed.get("is_2fa_enabled", False))),
        last_login=refreshed.get("last_login"),
    )


@router.post("/upload-photo", response_model=ProfilePhotoResponse)
async def upload_profile_photo(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> ProfilePhotoResponse:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image is empty")

    content_type = _resolve_profile_photo_content_type(file, content)
    suffix = _resolve_profile_photo_suffix(file.filename, content_type)
    safe_name = f"{current_user['_id']}-{uuid4().hex}{suffix}"

    try:
        if config.AWS_S3_BUCKET:
            photo_url = await s3_service.upload_bytes(
                content=content,
                content_type=content_type,
                filename=safe_name,
                owner_id=str(current_user["_id"]),
            )
        else:
            local_path = LOCAL_PROFILE_UPLOAD_DIR / safe_name
            local_path.write_bytes(content)
            photo_url = f"/uploads/profile/{safe_name}"
    except Exception as exc:
        logger.exception("Profile photo upload failed: user_id=%s", current_user.get("_id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Profile photo upload failed",
        ) from exc

    try:
        await db.users.update_one(
            {"_id": current_user["_id"]},
            {"$set": {"profile_picture": photo_url, "updated_at": datetime.utcnow()}},
        )
    except PyMongoError as exc:
        logger.exception("Failed to persist profile photo metadata: user_id=%s", current_user.get("_id"))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Profile photo uploaded but could not be saved",
        ) from exc

    logger.info("Profile photo updated: user_id=%s", current_user.get("_id"))
    return ProfilePhotoResponse(profile_picture=_to_photo_url(photo_url, request) or "")


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    payload: PasswordChangeRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    if not verify_password(payload.old_password, current_user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Old password is incorrect")

    await db.users.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": datetime.utcnow()}},
    )
    return MessageResponse(message="Password changed successfully")


@router.patch("/security", response_model=SecurityUpdateResponse)
async def update_security(
    payload: SecurityUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> SecurityUpdateResponse:
    await db.users.update_one(
        {"_id": current_user["_id"]},
        {
            "$set": {
                "two_factor_enabled": payload.two_factor_enabled,
                "is_2fa_enabled": payload.two_factor_enabled,
                "updated_at": datetime.utcnow(),
            }
        },
    )
    return SecurityUpdateResponse(two_factor_enabled=payload.two_factor_enabled)


@router.get("/storage", response_model=StorageInfoResponse)
async def get_storage_info(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> StorageInfoResponse:
    pipeline = [
        {"$match": {"owner_id": current_user["_id"], "is_deleted": {"$ne": True}}},
        {"$group": {"_id": None, "used": {"$sum": "$file_size"}, "file_count": {"$sum": 1}}},
    ]
    usage = await db.files.aggregate(pipeline).to_list(length=1)
    used = int(usage[0]["used"]) if usage else 0
    file_count = int(usage[0]["file_count"]) if usage else 0

    storage = await sync_user_storage_usage(db, current_user, used)
    return StorageInfoResponse(
        used=storage["used"],
        total=storage["total"],
        limit=storage["total"],
        remaining=storage["remaining"],
        file_count=file_count,
    )


@router.get("/backup", response_model=BackupSettingsResponse)
async def get_backup_settings(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> BackupSettingsResponse:
    user = await _ensure_profile_defaults(db, current_user)
    devices = [
        BackupDeviceEntry(
            name=str(item.get("name") or "Device"),
            last_sync_at=item.get("last_sync_at"),
            status=str(item.get("status") or "Idle"),
        )
        for item in user.get("devices", [])
        if item.get("name")
    ]
    return BackupSettingsResponse(
        backup_enabled=bool(user.get("backup_enabled", False)),
        devices=devices,
    )


@router.patch("/backup", response_model=BackupSettingsResponse)
async def update_backup_settings(
    payload: BackupSettingsUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> BackupSettingsResponse:
    user = await _ensure_profile_defaults(db, current_user)
    devices = list(user.get("devices", []))

    if payload.device_name:
        next_device = {
            "name": payload.device_name,
            "last_sync_at": payload.last_sync_at or (datetime.utcnow() if payload.backup_enabled else None),
            "status": payload.status or ("Active backup" if payload.backup_enabled else "Paused"),
        }
        replaced = False
        for index, item in enumerate(devices):
            if str(item.get("name")).strip().lower() != payload.device_name.strip().lower():
                continue
            devices[index] = {**item, **next_device}
            replaced = True
            break
        if not replaced:
            devices.append(next_device)

    await db.users.update_one(
        {"_id": current_user["_id"]},
        {
            "$set": {
                "backup_enabled": payload.backup_enabled,
                "devices": devices,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    refreshed = await db.users.find_one({"_id": current_user["_id"]})
    assert refreshed
    return BackupSettingsResponse(
        backup_enabled=bool(refreshed.get("backup_enabled", False)),
        devices=[
            BackupDeviceEntry(
                name=str(item.get("name") or "Device"),
                last_sync_at=item.get("last_sync_at"),
                status=str(item.get("status") or "Idle"),
            )
            for item in refreshed.get("devices", [])
            if item.get("name")
        ],
    )
