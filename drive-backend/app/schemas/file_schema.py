from __future__ import annotations
from datetime import datetime

from pydantic import BaseModel, Field


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_folder_id: str | None = None
    parent_folder: str | None = None


class RenameRequest(BaseModel):
    new_name: str = Field(min_length=1, max_length=255)


class MoveFileRequest(BaseModel):
    folder_id: str | None = None


class StarFileRequest(BaseModel):
    is_starred: bool


class ShareFileRequest(BaseModel):
    shared_with_user_id: str
    permission: str = Field(default="view", pattern="^(view|edit)$")


class RestoreVersionRequest(BaseModel):
    version_id: str | None = None
    version_index: int | None = Field(default=None, ge=0)


class DownloadZipRequest(BaseModel):
    file_ids: list[str] = Field(default_factory=list, min_length=1)


class FileVersionResponse(BaseModel):
    id: str
    file_name: str
    file_size: int
    file_type: str
    mime_type: str | None = None
    storage_path: str
    file_url: str | None = None
    thumbnail_url: str | None = None
    tags: list[str] = []
    created_at: datetime


class FileResponse(BaseModel):
    id: str
    file_name: str
    file_size: int
    file_type: str
    mime_type: str | None = None
    owner_id: str
    folder_id: str | None
    storage_path: str
    file_url: str | None = None
    thumbnail_url: str | None = None
    is_deleted: bool
    deleted_at: datetime | None = None
    is_starred: bool
    is_public: bool = False
    shared_with: list[str] = []
    permission: str = "write"
    share_expiry: datetime | None = None
    tags: list[str] = []
    version_count: int = 0
    created_at: datetime
    updated_at: datetime


class FolderResponse(BaseModel):
    id: str
    name: str
    owner_id: str
    parent_folder_id: str | None
    parent_folder: str | None = None
    is_deleted: bool
    deleted_at: datetime | None = None
    is_starred: bool
    shared_with: list[str] = []
    permission: str = "write"
    share_expiry: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


