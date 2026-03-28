from __future__ import annotations
from pydantic import BaseModel

from app.schemas.file_schema import FileResponse, FolderResponse


class SearchResponse(BaseModel):
    files: list[FileResponse]
    folders: list[FolderResponse]


