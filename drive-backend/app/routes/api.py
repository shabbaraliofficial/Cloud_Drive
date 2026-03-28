from __future__ import annotations
from fastapi import APIRouter

from app.routes.auth_routes import debug_router, router as auth_router
from app.routes.dashboard_routes import router as dashboard_router
from app.routes.drive_routes import router as drive_router
from app.routes.file_routes import router as file_router
from app.routes.folder_routes import router as folder_router
from app.routes.media_routes import router as media_router
from app.routes.payment_routes import router as payment_router
from app.routes.search_routes import router as search_router
from app.routes.share_routes import router as share_router
from app.routes.storage_routes import router as storage_router
from app.routes.trash_routes import router as trash_router
from app.routes.user_routes import router as user_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(debug_router)
api_router.include_router(user_router)
api_router.include_router(file_router)
api_router.include_router(folder_router)
api_router.include_router(drive_router)
api_router.include_router(media_router)
api_router.include_router(payment_router)
api_router.include_router(search_router)
api_router.include_router(share_router)
api_router.include_router(storage_router)
api_router.include_router(dashboard_router)
api_router.include_router(trash_router)


