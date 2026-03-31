from __future__ import annotations
from datetime import datetime
import logging
import os
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, Response, status
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

auth_router = APIRouter()
debug_router = APIRouter(prefix="/debug", tags=["Debug"])
router = auth_router
logger = logging.getLogger(__name__)

GOOGLE_REDIRECT_URI = config.GOOGLE_REDIRECT_URI or os.getenv("GOOGLE_REDIRECT_URI", "")
FRONTEND_URL = config.FRONTEND_URL


def _normalize_registration_identity(payload: RegisterRequest) -> tuple[str, str, str]:
    normalized_email = str(payload.email or payload.username or "").strip().lower()
    normalized_password = str(payload.password or "").strip()

    raw_username = str(payload.username or "").strip().lower().replace(" ", "_")
    if not raw_username or "@" in raw_username:
        raw_username = normalized_email.split("@", 1)[0]

    normalized_username = raw_username[:50] or normalized_email.split("@", 1)[0]
    return normalized_email, normalized_username, normalized_password


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    background_tasks: BackgroundTasks,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> RegisterResponse:
    logger.info("Register API called")
    normalized_email, normalized_username, normalized_password = _normalize_registration_identity(payload)

    existing_email_user = await db.users.find_one({"email": normalized_email})
    if existing_email_user:
        is_verified = bool(
            existing_email_user.get("is_email_verified", existing_email_user.get("is_verified", False))
        )
        if not is_verified:
            await db.users.update_one(
                {"_id": existing_email_user["_id"]},
                {
                    "$set": {
                        "is_active": True,
                        "is_verified": True,
                        "is_email_verified": True,
                        "updated_at": datetime.utcnow(),
                    }
                },
            )
            otp_service = OTPService(db)
            otp = await otp_service.create_otp(normalized_email, "register")
            background_tasks.add_task(send_otp_email, normalized_email, otp)
            logger.info("OTP email queued for registration resend: email=%s", normalized_email)
            response.status_code = status.HTTP_200_OK
            return RegisterResponse(message="Registration successful", email=normalized_email)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already registered")

    existing_mobile_user = await db.users.find_one({"mobile_number": payload.mobile_number})
    if existing_mobile_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

    resolved_username = normalized_username
    suffix = 0
    while await db.users.find_one({"username": resolved_username}):
        suffix += 1
        resolved_username = f"{normalized_username}{suffix}"

    now = datetime.utcnow()
    default_plan = build_plan_update("free")
    await db.users.insert_one(
        {
            "full_name": payload.full_name,
            "date_of_birth": payload.date_of_birth.isoformat(),
            "dob": payload.date_of_birth.isoformat(),
            "email": normalized_email,
            "mobile_number": payload.mobile_number,
            "phone_number": payload.mobile_number,
            "username": resolved_username,
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
            "password_hash": hash_password(normalized_password),
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

    otp_service = OTPService(db)
    otp = await otp_service.create_otp(normalized_email, "register")
    background_tasks.add_task(send_otp_email, normalized_email, otp)
    logger.info("OTP email queued for registration: email=%s", normalized_email)
    return RegisterResponse(message="Registration successful", email=normalized_email)


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
async def login(payload: dict[str, str], db: AsyncIOMotorDatabase = Depends(get_database)) -> AuthTokenResponse:
    logger.info("Login API called")

    identifier = str(payload.get("email") or payload.get("username") or "").strip()
    normalized_identifier = identifier.lower()
    password = str(payload.get("password") or "")

    if not normalized_identifier or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email and password are required")

    user = await db.users.find_one(
        {
            "$or": [
                {"email": normalized_identifier},
                {"username": identifier},
                {"username": normalized_identifier},
            ]
        }
    )

    password_hash = str((user or {}).get("password_hash") or "")
    if not user or not password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    try:
        password_valid = verify_password(password, password_hash)
    except Exception:
        logger.warning("Password verification failed because the stored hash is invalid: user_id=%s", user.get("_id"))
        password_valid = False

    if not password_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if (
        not user.get("is_active", False)
        or not user.get("is_verified", False)
        or not user.get("is_email_verified", user.get("is_verified", False))
    ):
        await db.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "is_active": True,
                    "is_verified": True,
                    "is_email_verified": True,
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        user = await db.users.find_one({"_id": user["_id"]})
        assert user is not None

    try:
        access_token = create_access_token(
            str(user["_id"]),
            extra={
                "email": user.get("email", ""),
                "username": user.get("username", ""),
            },
        )
        refresh_token = create_refresh_token(
            str(user["_id"]),
            extra={
                "email": user.get("email", ""),
                "username": user.get("username", ""),
            },
        )
    except RuntimeError as exc:
        logger.exception("JWT configuration error during login")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service is not configured",
        ) from exc

    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_login": datetime.utcnow(), "updated_at": datetime.utcnow()}},
    )

    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


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
async def forgot_password(
    payload: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> MessageResponse:
    user = await db.users.find_one({"email": payload.email})
    if user:
        otp_service = OTPService(db)
        otp = await otp_service.create_otp(payload.email, "forgot_password")
        background_tasks.add_task(send_otp_email, payload.email, otp)
        logger.info("OTP email queued for forgot password: email=%s", payload.email)
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
    background_tasks: BackgroundTasks,
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict[str, str]:
    otp_service = OTPService(db)
    otp = await otp_service.create_otp(email, "debug_test")
    background_tasks.add_task(send_otp_email, email, otp)
    logger.info("Debug OTP email queued: email=%s", email)
    return {"message": "Test OTP email queued", "email": email}

