from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.routes.serializers import serialize_file, serialize_folder
from app.services.search_service import (
    build_date_modified_filter,
    build_date_range_filter,
    build_encrypted_filter,
    build_file_text_filter,
    build_folder_name_filter,
    build_location_filter,
    build_owner_filter,
    build_search_type_query,
    build_shared_to_filter,
    build_starred_filter,
    should_include_folder_results,
)
from app.schemas.file_schema import FileResponse, FolderResponse
from app.schemas.search_schema import SearchResponse
from app.utils.query_helpers import build_accessible_file_query, build_accessible_folder_query

router = APIRouter(prefix="/api/search", tags=["Search"])


@router.get("", response_model=SearchResponse)
async def search_all(
    q: str = Query(default=""),
    name: str | None = Query(default=None),
    includes_words: str | None = Query(default=None),
    shared_to: str | None = Query(default=None),
    file_type: str | None = Query(default=None, alias="type"),
    owner: str | None = Query(default=None),
    location: str | None = Query(default=None),
    date_modified: str | None = Query(default=None),
    date_alias: str | None = Query(default=None, alias="date"),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    in_bin: bool | None = Query(default=None),
    is_deleted: bool | None = Query(default=None),
    starred: bool | None = Query(default=None),
    is_starred: bool | None = Query(default=None),
    encrypted: bool | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> SearchResponse:
    query_text = (name or q or "").strip()
    file_type_filter = build_search_type_query(file_type)
    owner_filter = build_owner_filter(owner, current_user["_id"])
    shared_to_filter = await build_shared_to_filter(
        db,
        shared_to=shared_to,
        owner_id=current_user["_id"],
    )
    location_filter = build_location_filter(location, "file")
    legacy_date_filter = build_date_range_filter(date_from, date_to, field_name="created_at")
    modified_date_filter = build_date_modified_filter(date_modified or date_alias)
    deleted_mode = "only" if in_bin is True or is_deleted is True else "active"
    starred_filter_value = True if starred is True or is_starred is True else None

    file_query = await build_accessible_file_query(
        db,
        current_user["_id"],
        build_file_text_filter(name=query_text, includes_words=includes_words),
        file_type_filter,
        owner_filter,
        location_filter,
        legacy_date_filter,
        modified_date_filter,
        build_starred_filter(starred_filter_value),
        build_encrypted_filter(encrypted),
        shared_to_filter,
        deleted_mode=deleted_mode,
    )
    file_docs = await db.files.find(file_query).sort("updated_at", -1).to_list(200)

    folder_docs = []
    if should_include_folder_results(
        file_type=file_type,
        includes_words=includes_words,
        encrypted=encrypted,
    ):
        folder_query = await build_accessible_folder_query(
            db,
            current_user["_id"],
            build_folder_name_filter(query_text),
            owner_filter,
            build_location_filter(location, "folder"),
            legacy_date_filter,
            modified_date_filter,
            build_starred_filter(starred_filter_value),
            shared_to_filter,
            deleted_mode=deleted_mode,
        )
        folder_docs = await db.folders.find(folder_query).sort("updated_at", -1).to_list(200)

    return SearchResponse(
        files=[serialize_file(item) for item in file_docs],
        folders=[serialize_folder(item) for item in folder_docs],
    )


@router.get("/files", response_model=list[FileResponse])
async def search_files(
    q: str = Query(default=""),
    file_type: str | None = Query(default=None, alias="type"),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    query = await build_accessible_file_query(
        db,
        current_user["_id"],
        build_file_text_filter(name=(q or "").strip(), includes_words=None),
        build_search_type_query(file_type),
        build_date_range_filter(date_from, date_to, field_name="created_at"),
    )
    files = await db.files.find(query).sort("updated_at", -1).to_list(200)
    return [serialize_file(item) for item in files]


@router.get("/folders", response_model=list[FolderResponse])
async def search_folders(
    q: str = Query(default=""),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FolderResponse]:
    query = await build_accessible_folder_query(
        db,
        current_user["_id"],
        build_folder_name_filter((q or "").strip()),
        build_date_range_filter(date_from, date_to, field_name="created_at"),
    )
    folders = await db.folders.find(query).sort("updated_at", -1).to_list(200)
    return [serialize_folder(item) for item in folders]
