from __future__ import annotations

from fastapi_mail import ConnectionConfig

from app.core import config

conf = ConnectionConfig(
    MAIL_USERNAME=config.SMTP_USER,
    MAIL_PASSWORD=config.SMTP_PASSWORD,
    MAIL_FROM=config.SMTP_FROM or config.SMTP_USER,
    MAIL_PORT=config.SMTP_PORT,
    MAIL_SERVER=config.SMTP_HOST,
    MAIL_STARTTLS=True,
    MAIL_SSL_TLS=False,
    USE_CREDENTIALS=bool(config.SMTP_USER and config.SMTP_PASSWORD),
    VALIDATE_CERTS=True,
)
