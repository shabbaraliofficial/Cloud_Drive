from __future__ import annotations
from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.routes.serializers import serialize_file, serialize_folder
from app.schemas.dashboard_schema import DashboardResponse

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> DashboardResponse:
    suggested_folders = await db.folders.find({"owner_id": current_user["_id"], "is_deleted": {"$ne": True}}).sort("updated_at", -1).to_list(5)
    suggested_files = await db.files.find({"owner_id": current_user["_id"], "is_deleted": {"$ne": True}}).sort("created_at", -1).to_list(5)
    recent_files = await db.files.find({"owner_id": current_user["_id"], "is_deleted": {"$ne": True}}).sort("updated_at", -1).to_list(10)
    return DashboardResponse(
        suggested_folders=[serialize_folder(item) for item in suggested_folders],
        suggested_files=[serialize_file(item) for item in suggested_files],
        recent_files=[serialize_file(item) for item in recent_files],
    )


