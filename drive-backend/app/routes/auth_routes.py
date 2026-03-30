from __future__ import annotations
from datetime import datetime
import logging
import os
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core import config
from app.database.mongodb import get_database
from app.schemas.auth_schema import (
    AuthTokenResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SocialLoginPlaceholderRequest,
    VerifyOtpRequest,
)
from app.schemas.common_schema import MessageResponse
from app.services.otp_service import OTPService
from app.utils.send_email import send_otp_email
from app.utils.jwt_handler import create_access_token, create_refresh_token, decode_token
from app.utils.password_handler import hash_password, verify_password
from app.utils.mongo_helpers import parse_object_id
from app.utils.oauth_config import oauth
from app.utils.plans import build_plan_update

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
debug_router = APIRouter(prefix="/api/debug", tags=["Debug"])
logger = logging.getLogger(__name__)

GOOGLE_REDIRECT_URI = config.GOOGLE_REDIRECT_URI or os.getenv("GOOGLE_REDIRECT_URI", "")
FRONTEND_URL = config.FRONTEND_URL


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> RegisterResponse:
    existing_email_user = await db.users.find_one({"email": payload.email})
    if existing_email_user:
        is_verified = bool(
            existing_email_user.get("is_email_verified", existing_email_user.get("is_verified", False))
        )
        if not is_verified:
            otp_service = OTPService(db)
            otp = await otp_service.create_otp(payload.email, "register")
            try:
                await send_otp_email(payload.email, otp)
                logger.info("OTP email sent for registration resend: email=%s", payload.email)
            except Exception as exc:
                logger.warning("Failed to resend registration OTP: email=%s error=%s", payload.email, exc)
            response.status_code = status.HTTP_200_OK
            return RegisterResponse(message="OTP resent to email", email=payload.email)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already registered")

    existing_username_or_mobile = await db.users.find_one(
        {
            "$or": [
                {"username": payload.username},
                {"mobile_number": payload.mobile_number},
            ]
        }
    )
    if existing_username_or_mobile:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

    now = datetime.utcnow()
    default_plan = build_plan_update("free")
    await db.users.insert_one(
        {
            "full_name": payload.full_name,
            "date_of_birth": payload.date_of_birth.isoformat(),
            "dob": payload.date_of_birth.isoformat(),
            "email": payload.email,
            "mobile_number": payload.mobile_number,
            "phone_number": payload.mobile_number,
            "username": payload.username,
            "profile_picture": None,
            "gender": None,
            "bio": None,
            "storage_used": 0,
            "storage_limit": default_plan["storage_limit"],
            "account_type": default_plan["account_type"],
            "plan": default_plan["plan"],
            "is_premium": default_plan["is_premium"],
            "two_factor_enabled": False,
            "last_login": None,
            "password_hash": hash_password(payload.password),
            "role": "user",
            "is_active": False,
            "is_verified": False,
            "is_2fa_enabled": False,
            "auth_notifications_enabled": True,
            "created_at": now,
            "updated_at": now,
        }
    )

    otp_service = OTPService(db)
    otp = await otp_service.create_otp(payload.email, "register")
    try:
        await send_otp_email(payload.email, otp)
        logger.info("OTP email sent for registration: email=%s", payload.email)
    except Exception as exc:
        logger.warning("Failed to send registration OTP: email=%s error=%s", payload.email, exc)
    return RegisterResponse(message="OTP sent to your email", email=payload.email)


@router.post("/verify-otp", response_model=MessageResponse)
async def verify_otp(payload: VerifyOtpRequest, db: AsyncIOMotorDatabase = Depends(get_database)) -> MessageResponse:
    purpose = payload.purpose.lower()
    otp_service = OTPService(db)
    valid = await otp_service.verify_otp(payload.email, purpose, payload.otp_code)
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OTP")

    if purpose == "register":
        await db.users.update_one(
            {"email": payload.email},
            {"$set": {"is_active": True, "is_verified": True, "updated_at": datetime.utcnow()}},
        )
    return MessageResponse(message="OTP verified successfully")


@router.post("/login", response_model=AuthTokenResponse)
async def login(payload: LoginRequest, db: AsyncIOMotorDatabase = Depends(get_database)) -> AuthTokenResponse:
    identifier = (payload.username or "").strip()
    user = await db.users.find_one(
        {
            "$or": [
                {"username": identifier},
                {"email": identifier},
            ]
        }
    )
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.get("is_active", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not active")

    try:
        access_token = create_access_token(str(user["_id"]), extra={"username": user["username"]})
        refresh_token = create_refresh_token(str(user["_id"]), extra={"username": user["username"]})
    except RuntimeError as exc:
        logger.exception("JWT configuration error during login")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service is not configured",
        ) from exc
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login": datetime.utcnow(), "updated_at": datetime.utcnow()}})
    return AuthTokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=AuthTokenResponse)
async def refresh_token(payload: RefreshTokenRequest, db: AsyncIOMotorDatabase = Depends(get_database)) -> AuthTokenResponse:
    try:
        token_payload = decode_token(payload.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

    if token_payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_id = token_payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token payload")

    revoked = await db.token_blacklist.find_one({"jti": token_payload.get("jti")})
    if revoked:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")

    user = await db.users.find_one({"_id": parse_object_id(user_id, "Invalid user id in token")})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    try:
        access_token = create_access_token(str(user["_id"]), extra={"username": user["username"]})
        refresh_token = create_refresh_token(str(user["_id"]), extra={"username": user["username"]})
    except RuntimeError as exc:
        logger.exception("JWT configuration error during token refresh")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service is not configured",
        ) from exc
    return AuthTokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncIOMotorDatabase = Depends(get_database)) -> MessageResponse:
    user = await db.users.find_one({"email": payload.email})
    if user:
        otp_service = OTPService(db)
        await otp_service.send_otp(payload.email, "forgot_password")
    return MessageResponse(message="If the email exists, OTP has been sent.")


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(payload: ResetPasswordRequest, db: AsyncIOMotorDatabase = Depends(get_database)) -> MessageResponse:
    user = await db.users.find_one({"email": payload.email})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    otp_service = OTPService(db)
    valid = await otp_service.verify_otp(payload.email, "forgot_password", payload.otp_code)
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OTP")

    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": datetime.utcnow()}},
    )
    return MessageResponse(message="Password reset successfully")


@router.post("/logout", response_model=MessageResponse)
async def logout(
    authorization: str | None = Header(default=None),
    x_refresh_token: str | None = Header(default=None, alias="X-Refresh-Token"),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    if payload.get("jti"):
        await db.token_blacklist.insert_one({"jti": payload["jti"], "token_type": payload.get("type", "access")})

    if x_refresh_token:
        try:
            refresh_payload = decode_token(x_refresh_token)
        except Exception:
            refresh_payload = None

        if refresh_payload and refresh_payload.get("jti"):
            await db.token_blacklist.insert_one(
                {"jti": refresh_payload["jti"], "token_type": refresh_payload.get("type", "refresh")}
            )

    return MessageResponse(message="Logged out successfully")


@router.post("/social/google", response_model=MessageResponse)
async def social_google(_: SocialLoginPlaceholderRequest) -> MessageResponse:
    return MessageResponse(message="Google social login placeholder endpoint.")


@router.post("/social/facebook", response_model=MessageResponse)
async def social_facebook(_: SocialLoginPlaceholderRequest) -> MessageResponse:
    return MessageResponse(message="Facebook social login placeholder endpoint.")


@router.post("/social/apple", response_model=MessageResponse)
async def social_apple(_: SocialLoginPlaceholderRequest) -> MessageResponse:
    return MessageResponse(message="Apple social login placeholder endpoint.")


@router.get("/google/login")
async def google_login(request: Request) -> RedirectResponse:
    try:
        redirect_uri = request.url_for("google_callback")
        logger.info("Starting Google OAuth login: redirect_uri=%s", redirect_uri)
        return await oauth.google.authorize_redirect(request, str(redirect_uri))
    except Exception as exc:
        logger.exception("Google OAuth login failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Google OAuth login failed") from exc


@router.get("/google/callback")
async def google_callback(
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> RedirectResponse:
    try:
        token = await oauth.google.authorize_access_token(request)
        profile = token.get("userinfo")
        if not profile:
            try:
                profile = await oauth.google.parse_id_token(request, token)
            except Exception:
                profile = {}
    except Exception as exc:
        logger.warning("Google OAuth callback token exchange failed: error=%s", exc)
        error_qs = urlencode({"oauth_error": "token_exchange_failed"})
        return RedirectResponse(url=f"{FRONTEND_URL}/login?{error_qs}", status_code=status.HTTP_302_FOUND)

    email = (profile or {}).get("email")
    if not email:
        logger.warning("Google OAuth callback missing email: profile=%s", profile)
        error_qs = urlencode({"oauth_error": "missing_email"})
        return RedirectResponse(url=f"{FRONTEND_URL}/login?{error_qs}", status_code=status.HTTP_302_FOUND)

    full_name = (profile or {}).get("name") or email.split("@")[0]
    picture = (profile or {}).get("picture")
    base_username = (email.split("@")[0] or "google_user").lower().replace(" ", "_")
    username = base_username

    user = await db.users.find_one({"email": email})
    if not user:
        suffix = 0
        while await db.users.find_one({"username": username}):
            suffix += 1
            username = f"{base_username}{suffix}"

        now = datetime.utcnow()
        default_plan = build_plan_update("free")
        insert_result = await db.users.insert_one(
            {
                "full_name": full_name,
                "date_of_birth": None,
                "dob": None,
                "email": email,
                "mobile_number": "",
                "phone_number": "",
                "username": username,
                "profile_picture": picture,
                "gender": None,
                "bio": None,
                "storage_used": 0,
                "storage_limit": default_plan["storage_limit"],
                "account_type": default_plan["account_type"],
                "plan": default_plan["plan"],
                "is_premium": default_plan["is_premium"],
                "two_factor_enabled": False,
                "last_login": now,
                "password_hash": "",
                "role": "user",
                "is_active": True,
                "is_verified": True,
                "is_email_verified": True,
                "is_2fa_enabled": False,
                "auth_notifications_enabled": True,
                "created_at": now,
                "updated_at": now,
            }
        )
        user = await db.users.find_one({"_id": insert_result.inserted_id})
    else:
        await db.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "full_name": user.get("full_name") or full_name,
                    "profile_picture": user.get("profile_picture") or picture,
                    "is_active": True,
                    "is_verified": True,
                    "is_email_verified": True,
                    "last_login": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        user = await db.users.find_one({"_id": user["_id"]})

    assert user is not None
    try:
        access_token = create_access_token(str(user["_id"]), extra={"username": user.get("username", "")})
        refresh_token = create_refresh_token(str(user["_id"]), extra={"username": user.get("username", "")})
    except RuntimeError as exc:
        logger.exception("JWT configuration error during Google OAuth callback")
        error_qs = urlencode({"oauth_error": "server_misconfigured"})
        return RedirectResponse(url=f"{FRONTEND_URL}/login?{error_qs}", status_code=status.HTTP_302_FOUND)

    query = urlencode(
        {
            "oauth": "success",
            "access_token": access_token,
            "refresh_token": refresh_token,
        }
    )
    return RedirectResponse(url=f"{FRONTEND_URL}/login?{query}", status_code=status.HTTP_302_FOUND)


@debug_router.get("/send-test-email")
async def send_test_email(
    email: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict[str, str]:
    otp_service = OTPService(db)
    otp = await otp_service.create_otp(email, "debug_test")
    try:
        await send_otp_email(email, otp)
        logger.info("Debug OTP email sent: email=%s", email)
    except Exception as exc:
        logger.warning("Debug OTP email failed: email=%s error=%s", email, exc)
    return {"message": "Test OTP email attempted", "email": email}

