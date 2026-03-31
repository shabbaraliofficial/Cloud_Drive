from __future__ import annotations

from fastapi import APIRouter
from fastapi.routing import APIRoute, APIWebSocketRoute

from app.routes.admin_routes import router as admin_router
from app.routes.auth_routes import auth_router, debug_router
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
API_PREFIX = "/api"


def _strip_api_prefix(path: str) -> str:
    if path == API_PREFIX:
        return ""
    if path.startswith(f"{API_PREFIX}/"):
        return path[len(API_PREFIX) :]
    return path


def _mount_router(router: APIRouter, *, prefix: str = "", tags: list[str] | None = None) -> None:
    extra_tags = list(tags or [])

    for route in router.routes:
        normalized_path = _strip_api_prefix(route.path)
        final_path = f"{prefix}{normalized_path}" or "/"

        if isinstance(route, APIRoute):
            api_router.add_api_route(
                final_path,
                route.endpoint,
                response_model=route.response_model,
                status_code=route.status_code,
                tags=extra_tags + list(route.tags),
                dependencies=route.dependencies,
                summary=route.summary,
                description=route.description,
                response_description=route.response_description,
                responses=route.responses,
                deprecated=route.deprecated,
                methods=list(route.methods or []),
                operation_id=route.operation_id,
                response_model_include=route.response_model_include,
                response_model_exclude=route.response_model_exclude,
                response_model_by_alias=route.response_model_by_alias,
                response_model_exclude_unset=route.response_model_exclude_unset,
                response_model_exclude_defaults=route.response_model_exclude_defaults,
                response_model_exclude_none=route.response_model_exclude_none,
                include_in_schema=route.include_in_schema,
                response_class=route.response_class,
                name=route.name,
                callbacks=route.callbacks,
                openapi_extra=route.openapi_extra,
                generate_unique_id_function=route.generate_unique_id_function,
            )
            continue

        if isinstance(route, APIWebSocketRoute):
            api_router.add_api_websocket_route(
                final_path,
                route.endpoint,
                name=route.name,
                dependencies=route.dependencies,
            )
            continue

        api_router.routes.append(route)


_mount_router(admin_router)
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(debug_router)
_mount_router(user_router)
_mount_router(file_router)
_mount_router(folder_router)
_mount_router(drive_router)
_mount_router(media_router)
_mount_router(payment_router)
_mount_router(search_router)
_mount_router(share_router)
_mount_router(storage_router)
_mount_router(dashboard_router)
_mount_router(trash_router)


