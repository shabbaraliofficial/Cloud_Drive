from __future__ import annotations
from pydantic import BaseModel

from app.schemas.file_schema import FileResponse, FolderResponse


class DashboardResponse(BaseModel):
    suggested_folders: list[FolderResponse]
    suggested_files: list[FileResponse]
    recent_files: list[FileResponse]


