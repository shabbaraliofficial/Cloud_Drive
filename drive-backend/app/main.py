from __future__ import annotations
from contextlib import asynccontextmanager
from pathlib import Path
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

# Load .env from repo root and backend root; never crash if missing
BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
for candidate in (BACKEND_ROOT / ".env", REPO_ROOT / ".env"):
    if candidate.exists():
        load_dotenv(dotenv_path=candidate, override=False)

print("AWS KEY loaded:", bool(os.getenv("AWS_ACCESS_KEY_ID")))

from app.core import config
from app.core.logging import setup_logging
from app.database.mongodb import close_mongo_connection, connect_to_mongo, test_mongo_connection
from app.routes.api import api_router
from app.routes.profile_routes import router as profile_router

setup_logging()

# MongoDB connection lifecycle
@asynccontextmanager
async def lifespan(_: FastAPI):
    print("Connecting to MongoDB...")
    await connect_to_mongo()
    print("MongoDB Connected ✅")
    yield
    print("Closing MongoDB connection...")
    await close_mongo_connection()
    print("MongoDB Closed ❌")

# Create FastAPI app
app = FastAPI(
    title=config.APP_NAME,
    debug=config.APP_DEBUG,
    lifespan=lifespan
)

# Required by Authlib OAuth to store state during redirect flow
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET_KEY", "change-this-session-secret"),
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS or ["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include all API routes
app.include_router(api_router)
app.include_router(profile_router)

uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Root endpoint (ADD THIS)
@app.get("/")
async def root():
    return {
        "message": "Drive Backend is running successfully 🚀",
        "docs": "http://127.0.0.1:8000/docs",
        "health": "http://127.0.0.1:8000/health"
    }

# Health check endpoint
@app.get("/health")
async def health():
    result = await test_mongo_connection()
    return {
        "status": "ok",
        "mongo": result
    }
