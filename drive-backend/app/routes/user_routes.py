from __future__ import annotations
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.schemas.common_schema import MessageResponse
from app.schemas.user_schema import (
    AuthSettingsUpdateRequest,
    ChangePasswordRequest,
    UserDirectoryEntry,
    UserProfileResponse,
    UserProfileUpdateRequest,
)
from app.utils.password_handler import hash_password, verify_password
from app.utils.storage import build_storage_payload, ensure_user_storage_limit
from app.utils.plans import infer_plan_from_user

router = APIRouter(prefix="/api/user", tags=["User"])


def _normalize_birth_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
    return None


def serialize_user_profile(user: dict) -> UserProfileResponse:
    phone_number = user.get("phone_number") or user.get("mobile_number") or ""
    dob = _normalize_birth_date(user.get("dob") or user.get("date_of_birth"))
    storage = build_storage_payload(
        int(user.get("storage_used", 0) or 0),
        user.get("storage_limit"),
    )
    return UserProfileResponse(
        id=str(user["_id"]),
        full_name=user.get("full_name") or user.get("username") or "",
        date_of_birth=dob,
        dob=dob,
        email=user["email"],
        profile_picture=user.get("profile_picture"),
        mobile_number=user.get("mobile_number") or phone_number,
        phone_number=phone_number,
        username=user["username"],
        gender=user.get("gender"),
        bio=user.get("bio"),
        role=user.get("role", "user"),
        plan=user.get("plan") or infer_plan_from_user(user),
        is_premium=bool(user.get("is_premium", False)),
        is_active=user.get("is_active", False),
        is_verified=user.get("is_verified", False),
        is_2fa_enabled=user.get("is_2fa_enabled", False),
        two_factor_enabled=user.get("two_factor_enabled", user.get("is_2fa_enabled", False)),
        auth_notifications_enabled=user.get("auth_notifications_enabled", True),
        storage_used=storage["used"],
        storage_limit=storage["total"],
        used=storage["used"],
        total=storage["total"],
        remaining=storage["remaining"],
        account_type=user.get("account_type", "Free"),
        last_login=user.get("last_login"),
        created_at=user["created_at"],
        updated_at=user["updated_at"],
    )


@router.get("/profile", response_model=UserProfileResponse)
async def get_profile(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserProfileResponse:
    await ensure_user_storage_limit(db, current_user)
    return serialize_user_profile(current_user)


@router.get("/directory", response_model=list[UserDirectoryEntry])
async def list_user_directory(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[UserDirectoryEntry]:
    docs = await db.users.find(
        {
            "_id": {"$ne": current_user["_id"]},
            "is_active": True,
        },
        {"username": 1, "full_name": 1, "email": 1},
    ).sort("username", 1).to_list(500)

    return [
        UserDirectoryEntry(
            id=str(doc["_id"]),
            username=doc.get("username") or "",
            full_name=doc.get("full_name") or doc.get("username") or "User",
            email=doc.get("email") or "",
        )
        for doc in docs
    ]


@router.patch("/profile", response_model=UserProfileResponse)
async def update_profile(
    payload: UserProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserProfileResponse:
    updates = payload.model_dump(mode="json", exclude_none=True)
    if "phone_number" in updates and "mobile_number" not in updates:
        updates["mobile_number"] = updates["phone_number"]
    if "mobile_number" in updates and "phone_number" not in updates:
        updates["phone_number"] = updates["mobile_number"]
    if "dob" in updates:
        updates["date_of_birth"] = updates["dob"]
    if updates:
        updates["updated_at"] = datetime.utcnow()
        await db.users.update_one({"_id": current_user["_id"]}, {"$set": updates})
    user = await db.users.find_one({"_id": current_user["_id"]})
    assert user
    await ensure_user_storage_limit(db, user)
    return serialize_user_profile(user)


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    payload: ChangePasswordRequest,
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


@router.patch("/auth-settings", response_model=UserProfileResponse)
async def update_auth_settings(
    payload: AuthSettingsUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> UserProfileResponse:
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        updates["updated_at"] = datetime.utcnow()
        await db.users.update_one({"_id": current_user["_id"]}, {"$set": updates})
    user = await db.users.find_one({"_id": current_user["_id"]})
    assert user
    await ensure_user_storage_limit(db, user)
    return serialize_user_profile(user)


