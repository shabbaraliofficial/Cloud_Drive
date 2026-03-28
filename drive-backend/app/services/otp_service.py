from __future__ import annotations
import random
from datetime import datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core import config
from app.services.email_service import EmailService, send_otp_email


class OTPService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.email = EmailService()

    def generate_code(self) -> str:
        return "".join(random.choices("0123456789", k=config.OTP_LENGTH))

    async def create_otp(self, email: str, purpose: str) -> str:
        code = self.generate_code()
        now = datetime.utcnow()
        await self.db.otp_codes.insert_one(
            {
                "email": email,
                "purpose": purpose,
                "otp_code": code,
                "expires_at": now + timedelta(minutes=config.OTP_EXPIRY_MINUTES),
                "is_used": False,
                "created_at": now,
            }
        )
        return code

    async def send_otp(self, email: str, purpose: str) -> None:
        code = await self.create_otp(email, purpose)
        await send_otp_email(email, code)

    async def verify_otp(self, email: str, purpose: str, code: str) -> bool:
        now = datetime.utcnow()
        otp = await self.db.otp_codes.find_one(
            {
                "email": email,
                "purpose": purpose,
                "otp_code": code,
                "is_used": False,
                "expires_at": {"$gt": now},
            },
            sort=[("created_at", -1)],
        )
        if not otp:
            return False
        await self.db.otp_codes.update_one({"_id": otp["_id"]}, {"$set": {"is_used": True}})
        return True


