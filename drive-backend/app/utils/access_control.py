from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

READ_PERMISSIONS = {"read", "viewer", "view"}
WRITE_PERMISSIONS = {"write", "editor", "edit"}


def normalize_permission(value: str | None, default: str = "read") -> str:
    candidate = str(value or "").strip().lower()
    if candidate in WRITE_PERMISSIONS:
        return "write"
    if candidate in READ_PERMISSIONS:
        return "read"

    fallback = str(default or "").strip().lower()
    if fallback in WRITE_PERMISSIONS:
        return "write"
    return "read"


def permission_rank(value: str | None) -> int:
    permission = normalize_permission(value)
    return 2 if permission == "write" else 1


def user_id_matches(left, right) -> bool:
    if left is None or right is None:
        return False
    return str(left) == str(right)


def _share_expiry(doc: dict | None):
    if not doc:
        return None
    return doc.get("share_expiry", doc.get("expires_at"))


def _is_share_active(expires_at) -> bool:
    return not expires_at or expires_at > datetime.utcnow()


def has_file_share(file_doc: dict, user_id) -> bool:
    return get_active_file_share_entry(file_doc, user_id) is not None


def get_active_file_share_entry(file_doc: dict | None, user_id) -> dict | None:
    if not file_doc or user_id is None:
        return None

    for share_entry in file_doc.get("share_entries", []):
        if not user_id_matches(share_entry.get("user_id"), user_id):
            continue
        if not _is_share_active(share_entry.get("expires_at")):
            continue
        return {
            "user_id": user_id,
            "expires_at": share_entry.get("expires_at"),
            "permission": normalize_permission(
                share_entry.get("permission"),
                file_doc.get("permission", "read"),
            ),
        }

    if any(user_id_matches(shared_user_id, user_id) for shared_user_id in file_doc.get("shared_with", [])):
        expires_at = _share_expiry(file_doc)
        if _is_share_active(expires_at):
            return {
                "user_id": user_id,
                "expires_at": expires_at,
                "permission": normalize_permission(file_doc.get("permission"), "read"),
            }

    return None


def get_active_folder_share_entry(folder_doc: dict | None, user_id) -> dict | None:
    if not folder_doc or user_id is None:
        return None

    for share_entry in folder_doc.get("share_entries", []):
        if not user_id_matches(share_entry.get("user_id"), user_id):
            continue
        if not _is_share_active(share_entry.get("expires_at")):
            continue
        return {
            "user_id": user_id,
            "expires_at": share_entry.get("expires_at"),
            "permission": normalize_permission(
                share_entry.get("permission"),
                folder_doc.get("permission", "read"),
            ),
        }

    if any(user_id_matches(shared_user_id, user_id) for shared_user_id in folder_doc.get("shared_with", [])):
        expires_at = _share_expiry(folder_doc)
        if _is_share_active(expires_at):
            return {
                "user_id": user_id,
                "expires_at": expires_at,
                "permission": normalize_permission(folder_doc.get("permission"), "read"),
            }

    return None


def build_active_file_share_query(user_id) -> dict:
    now = datetime.utcnow()
    return {
        "$or": [
            {"share_entries": {"$elemMatch": {"user_id": user_id, "expires_at": None}}},
            {"share_entries": {"$elemMatch": {"user_id": user_id, "expires_at": {"$gt": now}}}},
            {"shared_with": user_id, "share_expiry": None},
            {"shared_with": user_id, "share_expiry": {"$gt": now}},
            {"shared_with": user_id, "share_expiry": {"$exists": False}, "expires_at": None},
            {"shared_with": user_id, "share_expiry": {"$exists": False}, "expires_at": {"$gt": now}},
            {"shared_with": user_id, "share_expiry": {"$exists": False}, "expires_at": {"$exists": False}},
        ]
    }


def build_active_folder_share_query(user_id) -> dict:
    now = datetime.utcnow()
    return {
        "$or": [
            {"share_entries": {"$elemMatch": {"user_id": user_id, "expires_at": None}}},
            {"share_entries": {"$elemMatch": {"user_id": user_id, "expires_at": {"$gt": now}}}},
            {"shared_with": user_id, "share_expiry": None},
            {"shared_with": user_id, "share_expiry": {"$gt": now}},
            {"shared_with": user_id, "share_expiry": {"$exists": False}, "expires_at": None},
            {"shared_with": user_id, "share_expiry": {"$exists": False}, "expires_at": {"$gt": now}},
            {"shared_with": user_id, "share_expiry": {"$exists": False}, "expires_at": {"$exists": False}},
        ]
    }


def can_access_folder_direct(folder_doc: dict | None, user: dict | None) -> bool:
    if not folder_doc or folder_doc.get("is_deleted", False):
        return False
    return get_folder_permission_direct(folder_doc, user) is not None


def get_folder_permission_direct(folder_doc: dict | None, user: dict | None) -> str | None:
    if not folder_doc or folder_doc.get("is_deleted", False) or not user:
        return None
    if user_id_matches(folder_doc.get("owner_id"), user.get("_id")):
        return "write"
    share_entry = get_active_folder_share_entry(folder_doc, user.get("_id"))
    if share_entry:
        return normalize_permission(share_entry.get("permission"), "read")
    return None


async def get_folder_permission(
    db: AsyncIOMotorDatabase,
    folder_doc: dict | None,
    user: dict | None,
) -> str | None:
    if not folder_doc or folder_doc.get("is_deleted", False) or not user:
        return None

    best_permission: str | None = None
    visited_ids = set()
    current_doc = folder_doc

    while current_doc:
        current_key = str(current_doc.get("_id"))
        if current_key in visited_ids:
            break
        visited_ids.add(current_key)

        direct_permission = get_folder_permission_direct(current_doc, user)
        if direct_permission:
            if not best_permission or permission_rank(direct_permission) > permission_rank(best_permission):
                best_permission = direct_permission
            if best_permission == "write":
                return best_permission

        parent_id = current_doc.get("parent_folder_id") or current_doc.get("parent_folder")
        if not parent_id:
            break
        current_doc = await db.folders.find_one({"_id": parent_id, "is_deleted": {"$ne": True}})

    return best_permission


async def can_access_folder(
    db: AsyncIOMotorDatabase,
    folder_doc: dict | None,
    user: dict | None,
) -> bool:
    return await get_folder_permission(db, folder_doc, user) is not None


async def ensure_folder_access(
    db: AsyncIOMotorDatabase,
    folder_doc: dict | None,
    user: dict | None,
) -> None:
    if not folder_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    if not await can_access_folder(db, folder_doc, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this folder")


async def ensure_folder_write_access(
    db: AsyncIOMotorDatabase,
    folder_doc: dict | None,
    user: dict | None,
) -> None:
    if not folder_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    permission = await get_folder_permission(db, folder_doc, user)
    if permission != "write":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have write access to this folder")


async def get_file_permission(
    db: AsyncIOMotorDatabase,
    file_doc: dict | None,
    user: dict | None,
) -> str | None:
    if not file_doc or file_doc.get("is_deleted", False):
        return None

    if user and user_id_matches(file_doc.get("owner_id"), user.get("_id")):
        return "write"

    best_permission = "read" if file_doc.get("is_public", False) else None

    if user:
        share_entry = get_active_file_share_entry(file_doc, user.get("_id"))
        if share_entry:
            best_permission = normalize_permission(share_entry.get("permission"), "read")

        if file_doc.get("folder_id"):
            folder_doc = await db.folders.find_one(
                {"_id": file_doc["folder_id"], "is_deleted": {"$ne": True}}
            )
            folder_permission = await get_folder_permission(db, folder_doc, user)
            if folder_permission and (
                not best_permission or permission_rank(folder_permission) > permission_rank(best_permission)
            ):
                best_permission = folder_permission

    return best_permission


async def can_access_file(
    db: AsyncIOMotorDatabase,
    file_doc: dict | None,
    user: dict | None,
) -> bool:
    return await get_file_permission(db, file_doc, user) is not None


async def ensure_file_access(
    db: AsyncIOMotorDatabase,
    file_doc: dict | None,
    user: dict | None,
) -> None:
    if not file_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    if not await can_access_file(db, file_doc, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this file")


async def ensure_file_write_access(
    db: AsyncIOMotorDatabase,
    file_doc: dict | None,
    user: dict | None,
) -> None:
    if not file_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    permission = await get_file_permission(db, file_doc, user)
    if permission != "write":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have write access to this file")
