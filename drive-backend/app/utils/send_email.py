from __future__ import annotations

import logging

from fastapi_mail import FastMail, MessageSchema

from .email_config import conf

logger = logging.getLogger(__name__)


async def send_otp_email(email: str, otp: str) -> None:
    print(f"[send_email] Preparing OTP email for {email}")
    logger.info("Preparing OTP email for %s", email)

    if conf is None:
        print(f"[send_email] FastAPI-Mail is not configured for {email}")
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
        print(f"[send_email] Sending OTP email to {email}")
        logger.info("Sending OTP email to %s", email)
        await fm.send_message(message)
        print(f"[send_email] OTP email sent to {email}")
        logger.info("OTP email sent to %s", email)
    except Exception as exc:
        print(f"[send_email] Failed to send OTP email to {email}: {exc}")
        logger.exception("Failed to send OTP email to %s", email)
