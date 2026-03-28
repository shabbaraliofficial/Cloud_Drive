from __future__ import annotations

from fastapi_mail import FastMail, MessageSchema

from .email_config import conf


async def send_otp_email(email: str, otp: str) -> None:
    message = MessageSchema(
        subject="Your OTP - My Cloud Drive",
        recipients=[email],
        body=f"Your OTP is: {otp}",
        subtype="plain",
    )

    fm = FastMail(conf)
    await fm.send_message(message)
