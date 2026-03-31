from __future__ import annotations

import logging

from fastapi_mail import FastMail, MessageSchema

from .email_config import conf

logger = logging.getLogger(__name__)


async def send_otp_email(email: str, otp: str) -> None:
    if conf is None:
        logger.warning("FastAPI-Mail is not configured; skipping OTP email to %s", email)
        return

    message = MessageSchema(
        subject="Your OTP - My Cloud Drive",
        recipients=[email],
        body=f"Your OTP is: {otp}",
        subtype="plain",
    )

    fm = FastMail(conf)
    try:
        await fm.send_message(message)
    except Exception:
        logger.exception("Failed to send OTP email to %s", email)
