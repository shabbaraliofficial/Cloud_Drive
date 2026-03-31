from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from pathlib import Path
import secrets

from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError, PartialCredentialsError
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pymongo.errors import PyMongoError
from starlette.middleware.sessions import SessionMiddleware
import uvicorn

from app.core import config
from app.core.logging import setup_logging
from app.database.mongodb import close_mongo_connection, connect_to_mongo, test_mongo_connection
from app.routes.api import api_router
from app.routes.profile_routes import router as profile_router

setup_logging()
logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
SESSION_SECRET = config.SESSION_SECRET_KEY or secrets.token_urlsafe(32)


def _build_cors_origins() -> list[str]:
    origins = {"http://localhost:5173"}
    origins.update(origin for origin in config.CORS_ORIGINS if origin)
    if config.FRONTEND_URL:
        origins.add(config.FRONTEND_URL)
    return sorted(origins)


CORS_ORIGINS = _build_cors_origins()


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Starting backend lifespan")
    try:
        await connect_to_mongo()
        mongo_status = await test_mongo_connection()
        logger.info("MongoDB startup status: %s", mongo_status)
    except Exception:
        logger.exception("Unexpected MongoDB startup error; continuing without database connection")
    try:
        yield
    finally:
        logger.info("Shutting down backend lifespan")
        await close_mongo_connection()


app = FastAPI(
    title=config.APP_NAME,
    debug=config.APP_DEBUG,
    lifespan=lifespan,
)

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info("CORS allow_origins: %s", CORS_ORIGINS)

app.include_router(api_router)
app.include_router(profile_router)

uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

favicon_path = REPO_ROOT / "drive-clone" / "public" / "favicon.ico"


@app.exception_handler(PyMongoError)
async def handle_mongo_error(request: Request, exc: PyMongoError) -> JSONResponse:
    logger.exception("MongoDB error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Database operation failed"})


@app.exception_handler(ClientError)
async def handle_s3_client_error(request: Request, exc: ClientError) -> JSONResponse:
    logger.exception("S3 client error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=502, content={"detail": "File storage operation failed"})


@app.exception_handler(BotoCoreError)
@app.exception_handler(NoCredentialsError)
@app.exception_handler(PartialCredentialsError)
async def handle_s3_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("S3 error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=502, content={"detail": "File storage operation failed"})


@app.get("/")
def health_check():
    return {"status": "Backend running"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    if favicon_path.exists():
        return FileResponse(str(favicon_path))
    return Response(status_code=204)


@app.get("/health")
async def health():
    mongo = await test_mongo_connection()
    service_status = "ok" if float(mongo.get("ok", 0.0)) >= 1.0 else "degraded"
    return {
        "status": service_status,
        "mongo": mongo,
    }


if __name__ == "__main__":
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT)
