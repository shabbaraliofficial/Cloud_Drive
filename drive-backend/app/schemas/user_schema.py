from __future__ import annotations
from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field


class UserProfileResponse(BaseModel):
    id: str
    full_name: str
    date_of_birth: date | None = None
    dob: date | None = None
    email: EmailStr
    profile_picture: str | None = None
    mobile_number: str | None = None
    phone_number: str | None = None
    username: str
    gender: str | None = None
    bio: str | None = None
    role: str
    plan: str = "free"
    is_premium: bool = False
    is_active: bool
    is_verified: bool
    is_2fa_enabled: bool
    two_factor_enabled: bool | None = None
    auth_notifications_enabled: bool
    storage_used: int = 0
    storage_limit: int = 10737418240
    used: int = 0
    total: int = 10737418240
    remaining: int = 10737418240
    account_type: str = "Free"
    last_login: datetime | None = None
    created_at: datetime
    updated_at: datetime


class UserProfileUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    username: str | None = Field(default=None, min_length=3, max_length=60)
    mobile_number: str | None = Field(default=None, min_length=8, max_length=20)
    phone_number: str | None = Field(default=None, min_length=8, max_length=20)
    dob: date | None = None
    gender: str | None = Field(default=None, max_length=30)
    bio: str | None = Field(default=None, max_length=500)


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=128)


class AuthSettingsUpdateRequest(BaseModel):
    is_2fa_enabled: bool | None = None
    auth_notifications_enabled: bool | None = None


class UserDirectoryEntry(BaseModel):
    id: str
    username: str
    full_name: str
    email: EmailStr


