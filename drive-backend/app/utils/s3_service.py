from __future__ import annotations

import logging
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError, ProfileNotFound

from app.core import config

logger = logging.getLogger(__name__)


def _create_session():
    session_kwargs: dict[str, str] = {"region_name": config.AWS_REGION}
    if config.AWS_PROFILE:
        session_kwargs["profile_name"] = config.AWS_PROFILE
    elif config.AWS_ACCESS_KEY_ID and config.AWS_SECRET_ACCESS_KEY:
        session_kwargs["aws_access_key_id"] = config.AWS_ACCESS_KEY_ID
        session_kwargs["aws_secret_access_key"] = config.AWS_SECRET_ACCESS_KEY
        if config.AWS_SESSION_TOKEN:
            session_kwargs["aws_session_token"] = config.AWS_SESSION_TOKEN

    try:
        return boto3.session.Session(**session_kwargs)
    except ProfileNotFound as exc:
        raise RuntimeError(f"AWS profile '{config.AWS_PROFILE}' was not found") from exc


def _create_client():
    if not config.AWS_S3_BUCKET:
        raise RuntimeError("AWS_BUCKET_NAME not configured")

    session = _create_session()
    credentials = session.get_credentials()
    if not credentials:
        raise RuntimeError(
            "AWS credentials not found. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or configure AWS_PROFILE."
        )

    return session.client("s3", endpoint_url=config.AWS_S3_ENDPOINT_URL or None)


def build_s3_key(filename: str, owner_id: str | None = None, folder_id: str | None = None) -> str:
    safe_name = Path(filename or "unnamed").name or "unnamed"
    owner_prefix = str(owner_id or "public")
    folder_prefix = str(folder_id or "root")
    return f"uploads/{owner_prefix}/{folder_prefix}/{safe_name}"


def upload_file_to_s3(file_obj, key: str, content_type: str | None = None) -> str:
    client = _create_client()
    extra_args = {"ContentType": content_type or "application/octet-stream"}
    if config.AWS_S3_PUBLIC_READ:
        extra_args["ACL"] = "public-read"

    file_obj.seek(0)
    try:
        client.upload_fileobj(
            file_obj,
            config.AWS_S3_BUCKET,
            key,
            ExtraArgs=extra_args,
        )
        return f"https://{config.AWS_S3_BUCKET}.s3.{config.AWS_REGION}.amazonaws.com/{key}"
    except (BotoCoreError, ClientError) as exc:
        logger.exception("S3 upload failed: bucket=%s key=%s", config.AWS_S3_BUCKET, key)
        raise RuntimeError(f"S3 upload failed: {exc}") from exc
