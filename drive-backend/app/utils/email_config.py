from __future__ import annotations

import logging

from fastapi_mail import ConnectionConfig

from app.core import config

logger = logging.getLogger(__name__)


def _debug_mail_settings() -> None:
    print(f"[email_config] MAIL_USERNAME={config.MAIL_USERNAME or '<empty>'}")
    print(f"[email_config] MAIL_FROM={config.MAIL_FROM or '<empty>'}")


def build_mail_config() -> ConnectionConfig | None:
    _debug_mail_settings()

    username = (config.MAIL_USERNAME or "").strip()
    password = config.MAIL_PASSWORD or ""
    mail_from = (config.MAIL_FROM or "").strip()
    mail_server = (config.MAIL_SERVER or "smtp-relay.brevo.com").strip()
    mail_port = int(config.MAIL_PORT or 587)

    if not username or not password or not mail_from:
        logger.warning(
            "Email configuration is incomplete; FastAPI-Mail will be disabled. "
            "MAIL_USERNAME set=%s MAIL_FROM set=%s MAIL_SERVER=%s",
            bool(username),
            bool(mail_from),
            mail_server,
        )
        return None

    try:
        return ConnectionConfig(
            MAIL_USERNAME=username,
            MAIL_PASSWORD=password,
            MAIL_FROM=mail_from,
            MAIL_PORT=mail_port,
            MAIL_SERVER=mail_server,
            MAIL_STARTTLS=True,
            MAIL_SSL_TLS=False,
            USE_CREDENTIALS=True,
            VALIDATE_CERTS=True,
        )
    except Exception:
        logger.exception(
            "Failed to initialize FastAPI-Mail configuration. Email sending is disabled."
        )
        return None


conf = build_mail_config()
