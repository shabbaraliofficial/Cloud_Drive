from __future__ import annotations
import logging
from email.message import EmailMessage

import aiosmtplib

from app.core import config

logger = logging.getLogger(__name__)


class EmailService:
    async def send_email(self, to_email: str, subject: str, body: str) -> None:
        if not (config.MAIL_SERVER and config.MAIL_USERNAME and config.MAIL_PASSWORD and config.MAIL_FROM):
            logger.warning("SMTP not configured; skipping email send to %s", to_email)
            return

        message = EmailMessage()
        message["From"] = config.MAIL_FROM
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content(body)

        await aiosmtplib.send(
            message,
            hostname=config.MAIL_SERVER,
            port=config.MAIL_PORT,
            username=config.MAIL_USERNAME,
            password=config.MAIL_PASSWORD,
            start_tls=True,
        )


async def send_otp_email(to_email: str, otp: str) -> None:
    email_user = config.MAIL_USERNAME
    email_password = config.MAIL_PASSWORD
    smtp_host = config.MAIL_SERVER
    smtp_port = config.MAIL_PORT
    if not (smtp_host and email_user and email_password and config.MAIL_FROM):
        logger.warning("SMTP / email credentials not configured; skipping OTP email to %s", to_email)
        return

    message = EmailMessage()
    message["From"] = config.MAIL_FROM
    message["To"] = to_email
    message["Subject"] = "Your OTP Verification Code"
    message.set_content(f"Your OTP is: {otp}")
    message.add_alternative(
        f"""
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;background:#f6f8fb;padding:24px;">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
              <h2 style="margin:0 0 8px 0;color:#111827;">My Cloud Drive</h2>
              <p style="margin:0 0 16px 0;color:#4b5563;">Use the OTP below to verify your account.</p>
              <div style="margin:16px 0;padding:16px;background:#eef2ff;border-radius:10px;text-align:center;">
                <span style="font-size:36px;letter-spacing:6px;font-weight:800;color:#1f2937;">{otp}</span>
              </div>
              <p style="margin:0;color:#6b7280;font-size:13px;">This OTP expires soon. Do not share this code with anyone.</p>
            </div>
          </body>
        </html>
        """,
        subtype="html",
    )

    await aiosmtplib.send(
        message,
        hostname=smtp_host,
        port=smtp_port,
        username=email_user,
        password=email_password,
        start_tls=True,
    )


