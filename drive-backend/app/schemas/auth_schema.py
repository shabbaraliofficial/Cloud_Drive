from __future__ import annotations
from datetime import date

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    full_name: str = Field(min_length=2, max_length=120)
    date_of_birth: date
    email: EmailStr | None = None
    mobile_number: str = Field(min_length=8, max_length=20)
    username: str | None = Field(default=None, min_length=3, max_length=120)
    password: str | None = Field(default=None, min_length=8, max_length=128)

    @model_validator(mode="before")
    @classmethod
    def normalize_aliases(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data

        payload = dict(data)
        if not payload.get("email") and payload.get("username"):
            payload["email"] = payload["username"]
        if not payload.get("password") and payload.get("pass") is not None:
            payload["password"] = payload["pass"]
        return payload

    @model_validator(mode="after")
    def validate_required_fields(self) -> "RegisterRequest":
        if not self.email and not self.username:
            raise ValueError("Either email or username is required")
        if not self.password:
            raise ValueError("Either password or pass is required")
        return self


class RegisterResponse(BaseModel):
    message: str
    email: EmailStr


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp_code: str = Field(min_length=4, max_length=8)
    purpose: str = Field(default="register")


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp_code: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=8, max_length=128)


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class SocialLoginPlaceholderRequest(BaseModel):
    provider: str
    auth_code: str

