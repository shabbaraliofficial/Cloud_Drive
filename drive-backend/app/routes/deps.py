from __future__ import annotations
from fastapi import Depends, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database.mongodb import get_database
from app.utils.jwt_handler import decode_token
from app.utils.mongo_helpers import parse_object_id


async def _resolve_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except Exception:
        return None

    if payload.get("type") != "access":
        return None

    if payload.get("jti"):
        revoked = await db.token_blacklist.find_one({"jti": payload["jti"]})
        if revoked:
            return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    try:
        parsed_user_id = parse_object_id(user_id, "Invalid user id in token")
    except HTTPException:
        return None

    user = await db.users.find_one({"_id": parsed_user_id})
    if not user:
        return None
    if not user.get("is_active", False):
        return None
    return user


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    user = await _resolve_current_user(authorization, db)
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user


async def get_optional_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict | None:
    return await _resolve_current_user(authorization, db)


