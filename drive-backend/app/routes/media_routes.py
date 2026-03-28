from __future__ import annotations

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.routes.serializers import serialize_file
from app.schemas.file_schema import FileResponse
from app.utils.query_helpers import build_accessible_file_query

router = APIRouter(prefix="/api/media", tags=["Media"])


@router.get("", response_model=list[FileResponse])
async def list_media(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> list[FileResponse]:
    media_query = await build_accessible_file_query(
        db,
        current_user["_id"],
        {
            "$or": [
                {"mime_type": {"$regex": "^(image|video)/", "$options": "i"}},
                {"file_type": {"$regex": "^(image|video)/", "$options": "i"}},
                {"tags": {"$in": ["image", "video"]}},
            ]
        },
    )
    docs = await db.files.find(media_query).sort("created_at", -1).to_list(1000)
    return [serialize_file(item) for item in docs]
