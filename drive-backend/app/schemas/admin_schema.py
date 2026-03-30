from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr


class AdminUserResponse(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    username: str
    storage_used: int = 0
    storage_limit: int = 0
    plan: str = "free"
    account_type: str = "Free"
    is_premium: bool = False
    role: str = "user"
    status: str = "active"
    is_active: bool = True
    is_verified: bool = False
    file_count: int = 0
    last_login: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminFileResponse(BaseModel):
    id: str
    file_name: str
    owner_id: str
    owner_name: str
    owner_email: EmailStr | None = None
    file_size: int = 0
    file_type: str
    mime_type: str | None = None
    file_url: str | None = None
    folder_id: str | None = None
    is_deleted: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminStatsResponse(BaseModel):
    total_users: int = 0
    total_files: int = 0
    total_storage_used: int = 0


class AdminAnalyticsStorageResponse(BaseModel):
    used: int = 0
    free: int = 0


class AdminAnalyticsFileTypesResponse(BaseModel):
    image: int = 0
    video: int = 0
    pdf: int = 0
    other: int = 0


class AdminAnalyticsDailyPoint(BaseModel):
    date: str
    count: int = 0


class AdminAnalyticsUserGrowthPoint(BaseModel):
    month: str
    users: int = 0


class AdminAnalyticsResponse(BaseModel):
    storage: AdminAnalyticsStorageResponse
    file_types: AdminAnalyticsFileTypesResponse
    uploads_last_7_days: list[AdminAnalyticsDailyPoint] = []
    user_growth: list[AdminAnalyticsUserGrowthPoint] = []


class AdminUserDetailResponse(BaseModel):
    user: AdminUserResponse
    files: list[AdminFileResponse] = []
