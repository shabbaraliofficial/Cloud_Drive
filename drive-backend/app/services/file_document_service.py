from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

from app.services.tagging_service import generate_file_tags


def normalize_file_name(filename: str | None) -> str:
    return Path(filename or "unnamed").name or "unnamed"


def normalize_mime_type(mime_type: str | None) -> str:
    return (mime_type or "application/octet-stream").strip() or "application/octet-stream"


def build_file_document(
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
    now = datetime.utcnow()
    safe_filename = normalize_file_name(filename)
    safe_mime_type = normalize_mime_type(mime_type)
    safe_size = max(int(file_size or 0), 0)
    file_doc = {
        "file_name": safe_filename,
        "filename": safe_filename,
        "file_size": safe_size,
        "size": safe_size,
        "file_type": safe_mime_type,
        "mime_type": safe_mime_type,
        "owner_id": owner_id,
        "folder_id": folder_id,
        "storage_path": file_url,
        "file_url": file_url,
        "thumbnail_url": thumbnail_url,
        "is_deleted": False,
        "deleted_at": None,
        "is_starred": False,
        "is_public": False,
        "shared_with": [],
        "share_entries": [],
        "share_expiry": None,
        "tags": generate_file_tags(safe_filename, safe_mime_type),
        "versions": [],
        "permission": "write",
        "created_at": now,
        "updated_at": now,
    }
    if s3_key:
        file_doc["s3_key"] = s3_key
    return file_doc


def build_file_version_entry(file_doc: dict) -> dict:
    safe_filename = normalize_file_name(file_doc.get("file_name") or file_doc.get("filename"))
    safe_mime_type = normalize_mime_type(file_doc.get("mime_type") or file_doc.get("file_type"))
    safe_size = max(int(file_doc.get("file_size") or file_doc.get("size") or 0), 0)
    storage_path = file_doc.get("storage_path") or file_doc.get("file_url") or ""
    return {
        "id": str(file_doc.get("version_id") or uuid4().hex),
        "file_name": safe_filename,
        "filename": safe_filename,
        "file_size": safe_size,
        "size": safe_size,
        "file_type": safe_mime_type,
        "mime_type": safe_mime_type,
        "storage_path": storage_path,
        "file_url": file_doc.get("file_url") or storage_path,
        "thumbnail_url": file_doc.get("thumbnail_url"),
        "s3_key": file_doc.get("s3_key"),
        "tags": list(file_doc.get("tags", [])),
        "created_at": file_doc.get("updated_at") or file_doc.get("created_at") or datetime.utcnow(),
    }


def normalize_file_versions(versions: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    for version in versions or []:
        normalized.append(
            {
                "id": str(version.get("id") or uuid4().hex),
                "file_name": normalize_file_name(version.get("file_name") or version.get("filename")),
                "filename": normalize_file_name(version.get("filename") or version.get("file_name")),
                "file_size": max(int(version.get("file_size") or version.get("size") or 0), 0),
                "size": max(int(version.get("size") or version.get("file_size") or 0), 0),
                "file_type": normalize_mime_type(version.get("file_type") or version.get("mime_type")),
                "mime_type": normalize_mime_type(version.get("mime_type") or version.get("file_type")),
                "storage_path": version.get("storage_path") or version.get("file_url") or "",
                "file_url": version.get("file_url") or version.get("storage_path") or "",
                "thumbnail_url": version.get("thumbnail_url"),
                "s3_key": version.get("s3_key"),
                "tags": list(version.get("tags", [])),
                "created_at": version.get("created_at") or datetime.utcnow(),
            }
        )
    return normalized


def build_storage_usage_pipeline(owner_id) -> list[dict]:
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
        {"$match": {"owner_id": owner_id, "is_deleted": {"$ne": True}}},
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
        {"$group": {"_id": None, "used": {"$sum": "$total_size"}}},
    ]


def get_total_file_storage_size(file_doc: dict) -> int:
    current_size = max(int(file_doc.get("file_size") or file_doc.get("size") or 0), 0)
    version_size = sum(
        max(int(version.get("file_size") or version.get("size") or 0), 0)
        for version in file_doc.get("versions", [])
    )
    return current_size + version_size


def iter_file_asset_keys(file_doc: dict):
    seen: set[str] = set()
    for item in [file_doc, *normalize_file_versions(file_doc.get("versions"))]:
        primary = item.get("s3_key") or item.get("storage_path") or item.get("file_url")
        thumbnail = item.get("thumbnail_url")
        for candidate in (primary, thumbnail):
            value = str(candidate or "").strip()
            if not value or value in seen:
                continue
            seen.add(value)
            yield value
