from __future__ import annotations
from app.services.file_document_service import normalize_mime_type
from app.schemas.file_schema import FileResponse, FileVersionResponse, FolderResponse
from app.utils.access_control import normalize_permission


def serialize_file(doc: dict) -> FileResponse:
    filename = doc.get("file_name") or doc.get("filename") or "Untitled file"
    mime_type = normalize_mime_type(doc.get("mime_type") or doc.get("file_type"), filename)
    return FileResponse(
        id=str(doc["_id"]),
        file_name=filename,
        file_size=doc.get("file_size") or doc.get("size") or 0,
        file_type=mime_type,
        mime_type=mime_type,
        owner_id=str(doc["owner_id"]),
        folder_id=str(doc["folder_id"]) if doc.get("folder_id") else None,
        storage_path=doc.get("storage_path") or doc.get("file_url") or "",
        file_url=doc.get("file_url") or doc.get("storage_path"),
        thumbnail_url=doc.get("thumbnail_url"),
        is_deleted=doc.get("is_deleted", False),
        deleted_at=doc.get("deleted_at"),
        is_starred=doc.get("is_starred", False),
        is_public=doc.get("is_public", False),
        shared_with=[str(item) for item in doc.get("shared_with", [])],
        permission=normalize_permission(doc.get("permission"), "write"),
        share_expiry=doc.get("share_expiry"),
        tags=list(doc.get("tags", [])),
        version_count=len(doc.get("versions", [])),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


def serialize_file_version(doc: dict) -> FileVersionResponse:
    filename = doc.get("file_name") or doc.get("filename") or "Untitled file"
    mime_type = normalize_mime_type(doc.get("mime_type") or doc.get("file_type"), filename)
    return FileVersionResponse(
        id=str(doc.get("id") or ""),
        file_name=filename,
        file_size=doc.get("file_size") or doc.get("size") or 0,
        file_type=mime_type,
        mime_type=mime_type,
        storage_path=doc.get("storage_path") or doc.get("file_url") or "",
        file_url=doc.get("file_url") or doc.get("storage_path"),
        thumbnail_url=doc.get("thumbnail_url"),
        tags=list(doc.get("tags", [])),
        created_at=doc.get("created_at"),
    )


def serialize_folder(doc: dict) -> FolderResponse:
    parent_id = doc.get("parent_folder_id") or doc.get("parent_folder")
    return FolderResponse(
        id=str(doc["_id"]),
        name=doc["name"],
        owner_id=str(doc["owner_id"]),
        parent_folder_id=str(parent_id) if parent_id else None,
        parent_folder=str(parent_id) if parent_id else None,
        is_deleted=doc.get("is_deleted", False),
        deleted_at=doc.get("deleted_at"),
        is_starred=doc.get("is_starred", False),
        shared_with=[str(item) for item in doc.get("shared_with", [])],
        permission=normalize_permission(doc.get("permission"), "write"),
        share_expiry=doc.get("share_expiry"),
        expires_at=doc.get("expires_at"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


