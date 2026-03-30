from __future__ import annotations

import logging
import mimetypes
import os
import subprocess
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import boto3
from anyio import to_thread
from botocore.credentials import ReadOnlyCredentials
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    NoCredentialsError,
    PartialCredentialsError,
    ProfileNotFound,
)
from fastapi import HTTPException, status

from app.core import config

logger = logging.getLogger(__name__)


class _LocalBody:
    def __init__(self, path: Path, default_chunk_size: int = 64 * 1024) -> None:
        self.path = path
        self.default_chunk_size = default_chunk_size

    def iter_chunks(self, chunk_size: int | None = None):
        read_size = chunk_size or self.default_chunk_size
        with self.path.open("rb") as fh:
            while True:
                chunk = fh.read(read_size)
                if not chunk:
                    break
                yield chunk


class S3Service:
    def __init__(self) -> None:
        self.bucket = config.AWS_S3_BUCKET
        self.region = config.AWS_REGION
        self.endpoint_url = config.AWS_S3_ENDPOINT_URL or None
        self.local_upload_root = Path(__file__).resolve().parents[2] / "uploads"
        self.local_upload_root.mkdir(parents=True, exist_ok=True)

        self.session_error: str | None = None
        self.session = self._create_session()
        self.client = self._create_client()
        self.credentials = self._resolve_credentials()
        self.auth_source = self._detect_auth_source()
        self.enabled = bool(self.bucket and self.client and self.credentials)

        self._log_status()

    def _create_session(self):
        session_kwargs: dict[str, str] = {}
        if self.region:
            session_kwargs["region_name"] = self.region
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
            self.session_error = f"AWS profile '{config.AWS_PROFILE}' was not found"
            logger.error(self.session_error)
            logger.debug("Profile resolution error", exc_info=exc)
            return None

    def _create_client(self):
        if not self.bucket or not self.session:
            return None
        return self.session.client("s3", endpoint_url=self.endpoint_url)

    def _resolve_credentials(self) -> ReadOnlyCredentials | None:
        if not self.session:
            return None

        try:
            credentials = self.session.get_credentials()
            if not credentials:
                return None
            frozen = credentials.get_frozen_credentials()
            if not frozen.access_key or not frozen.secret_key:
                return None
            return frozen
        except (BotoCoreError, ProfileNotFound) as exc:
            self.session_error = str(exc)
            logger.error("Failed to resolve AWS credentials: %s", exc)
            return None

    def _detect_auth_source(self) -> str:
        if config.AWS_PROFILE:
            return f"profile:{config.AWS_PROFILE}"
        if config.AWS_ACCESS_KEY_ID and config.AWS_SECRET_ACCESS_KEY:
            return "env"
        if self.credentials:
            return "default-chain"
        return "none"

    def _log_status(self) -> None:
        if not self.bucket:
            logger.warning("S3 bucket is not configured. Uploads will use local storage.")
            return

        if self.enabled:
            logger.info(
                "S3 enabled: bucket=%s region=%s auth_source=%s endpoint_url=%s",
                self.bucket,
                self.region,
                self.auth_source,
                self.endpoint_url or "<aws-default>",
            )
            return

        reason = self.session_error or "no AWS credentials were resolved from env, AWS_PROFILE, or the default boto3 chain"
        logger.warning(
            "S3 bucket is configured but unavailable: bucket=%s region=%s auth_source=%s reason=%s",
            self.bucket,
            self.region,
            self.auth_source,
            reason,
        )

    def _public_url(self, key: str) -> str:
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"

    def _upload_thumbnail_bytes(self, thumbnail_bytes: bytes, thumb_key: str) -> str:
        buffer = BytesIO(thumbnail_bytes)
        buffer.seek(0)
        assert self.client is not None
        self.client.upload_fileobj(
            buffer,
            self.bucket,
            thumb_key,
            ExtraArgs=self._object_upload_args("image/jpeg"),
        )
        return self._public_url(thumb_key)

    def _render_image_thumbnail_bytes(self, content: bytes) -> bytes:
        from PIL import Image  # type: ignore

        image = Image.open(BytesIO(content))
        image = image.convert("RGB")
        if image.width > 300:
            height = max(1, round((300 / image.width) * image.height))
            image = image.resize((300, height))

        output = BytesIO()
        image.save(output, format="JPEG", quality=85, optimize=True)
        return output.getvalue()

    def _create_video_thumbnail_from_source(self, source: str, thumb_key: str, ffmpeg_bin: str) -> str | None:
        tmp_out = Path(os.getenv("TMPDIR", ".")) / f"{uuid4().hex}.jpg"

        try:
            cmd = [
                ffmpeg_bin,
                "-y",
                "-ss",
                "00:00:02",
                "-i",
                source,
                "-frames:v",
                "1",
                "-vf",
                "scale=300:-1",
                str(tmp_out),
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not tmp_out.exists():
                return None

            with tmp_out.open("rb") as fh:
                assert self.client is not None
                self.client.upload_fileobj(
                    fh,
                    self.bucket,
                    thumb_key,
                    ExtraArgs=self._object_upload_args("image/jpeg"),
                )
            return self._public_url(thumb_key)
        except Exception:
            return None
        finally:
            if tmp_out.exists():
                tmp_out.unlink(missing_ok=True)

    def _object_upload_args(self, content_type: str) -> dict[str, str]:
        return {
            "ContentType": content_type,
            "ACL": "public-read",
        }

    def _multipart_upload_args(self, content_type: str) -> dict[str, str]:
        return {
            "ContentType": content_type,
            "ACL": "public-read",
        }

    def _format_s3_error(self, exc: Exception, operation: str = "S3 operation") -> str:
        if isinstance(exc, ClientError):
            error = exc.response.get("Error", {})
            code = error.get("Code", "Unknown")
            message = error.get("Message", str(exc))
            if code == "AccessDenied":
                if operation == "PutObject":
                    return (
                        "S3 AccessDenied during PutObject. Your bucket or IAM policy likely rejects ACL=public-read. "
                        "Allow s3:PutObjectAcl and public-read object uploads for this bucket."
                    )
                return f"S3 AccessDenied during {operation}. Check IAM permission for s3:{operation} on this bucket/key."
            return f"S3 {code}: {message}"
        return str(exc)

    def _extract_key(self, storage_path: str) -> str:
        if storage_path.startswith("http://") or storage_path.startswith("https://"):
            parsed = urlparse(storage_path)
            return parsed.path.lstrip("/")
        return storage_path

    def extract_key(self, storage_path: str) -> str:
        return self._extract_key(storage_path)

    def _is_local_upload(self, storage_path: str) -> bool:
        return storage_path.startswith("/uploads/")

    def _local_upload_path(self, relative_path: str) -> Path:
        normalized = relative_path.replace("\\", "/").lstrip("/")
        if normalized.startswith("uploads/"):
            normalized = normalized[len("uploads/") :]
        return self.local_upload_root / Path(normalized)

    def _store_local_file(self, content: bytes, filename: str, owner_id: str, folder_id: str | None = None) -> str:
        safe_name = Path(filename).name or "unnamed"
        folder_prefix = folder_id or "root"
        relative_path = Path(owner_id) / folder_prefix / f"{uuid4().hex}-{safe_name}"
        target = self._local_upload_path(str(relative_path))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return f"/uploads/{relative_path.as_posix()}"

    def _s3_unavailable_detail(self) -> str:
        if not self.bucket:
            return "S3 bucket not configured. Set AWS_BUCKET_NAME."
        if self.session_error:
            return f"S3 configuration error: {self.session_error}"
        return (
            "AWS credentials not found for S3. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET_NAME, and AWS_REGION."
        )

    def _ensure_s3_ready(self) -> bool:
        if self.enabled and self.client:
            return True
        detail = self._s3_unavailable_detail()
        logger.warning("S3 unavailable: %s", detail)
        self.enabled = False
        return False

    async def upload_bytes(
        self,
        content: bytes,
        content_type: str,
        filename: str,
        owner_id: str,
        folder_id: str | None = None,
    ) -> str:
        if not self.bucket:
            return self._store_local_file(content, filename, owner_id, folder_id)
        if not self._ensure_s3_ready():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=self._s3_unavailable_detail(),
            )

        safe_name = Path(filename).name or "unnamed"
        key = self.build_key(
            owner_id=owner_id,
            filename=safe_name,
            folder_id=folder_id,
            prefix="uploads",
        )

        def _upload() -> None:
            assert self.client is not None
            self.client.upload_fileobj(
                Fileobj=BytesIO(content),
                Bucket=self.bucket,
                Key=key,
                ExtraArgs=self._object_upload_args(content_type),
            )

        try:
            await to_thread.run_sync(_upload)
            logger.info("Uploaded object to S3: bucket=%s key=%s", self.bucket, key)
            return self._public_url(key)
        except Exception as exc:
            logger.error("Failed to upload object to S3: bucket=%s key=%s error=%s", self.bucket, key, self._format_s3_error(exc, operation="PutObject"))
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="File upload to S3 failed",
            ) from exc

    def build_key(self, owner_id: str, filename: str, folder_id: str | None = None, prefix: str = "uploads") -> str:
        safe_name = Path(filename).name or "unnamed"
        folder_prefix = folder_id or "root"
        return f"{prefix}/{owner_id}/{folder_prefix}/{uuid4().hex}-{safe_name}"

    async def get_presigned_put_url(
        self,
        owner_id: str,
        filename: str,
        content_type: str,
        folder_id: str | None = None,
        expires_in: int = 3600,
    ) -> dict:
        if not self.bucket or not self._ensure_s3_ready():
            # Provide a local fallback so callers can still proceed
            local_url = self._store_local_file(b"", filename, owner_id, folder_id)
            return {
                "upload_url": None,
                "file_url": local_url,
                "key": local_url,
                "warning": "S3 unavailable; using local upload fallback.",
            }

        key = self.build_key(owner_id=owner_id, filename=filename, folder_id=folder_id, prefix="uploads")

        def _create() -> str:
            assert self.client is not None
            params = {
                "Bucket": self.bucket,
                "Key": key,
                "ContentType": content_type,
                "ACL": "public-read",
            }
            return self.client.generate_presigned_url(
                "put_object",
                Params=params,
                ExpiresIn=expires_in,
            )

        try:
            upload_url = await to_thread.run_sync(_create)
            return {"upload_url": upload_url, "file_url": self._public_url(key), "key": key}
        except Exception as exc:
            logger.error("Failed to create presigned PUT URL, falling back to local: %s", self._format_s3_error(exc, "put_object"))
            local_url = self._store_local_file(b"", filename, owner_id, folder_id)
            return {
                "upload_url": None,
                "file_url": local_url,
                "key": key,
                "warning": "S3 unavailable; using local upload fallback.",
            }

    async def get_presigned_get_url(self, key: str, expires_in: int = 3600) -> str:
        if not self.bucket or not self._ensure_s3_ready():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="S3 is not configured")
        object_key = self._extract_key(key)

        def _create() -> str:
            assert self.client is not None
            return self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": object_key},
                ExpiresIn=expires_in,
            )

        try:
            return await to_thread.run_sync(_create)
        except Exception as exc:
            logger.error("Failed to create presigned GET URL: bucket=%s key=%s error=%s", self.bucket, object_key, self._format_s3_error(exc, "GetObject"))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not create file download URL",
            ) from exc

    async def start_multipart_upload(
        self,
        owner_id: str,
        filename: str,
        content_type: str,
        folder_id: str | None = None,
    ) -> dict:
        if not self.bucket or not self._ensure_s3_ready():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="S3 is not configured")

        key = self.build_key(owner_id=owner_id, filename=filename, folder_id=folder_id, prefix="uploads")

        def _start() -> str:
            assert self.client is not None
            response = self.client.create_multipart_upload(Bucket=self.bucket, Key=key, **self._multipart_upload_args(content_type))
            return response["UploadId"]

        try:
            upload_id = await to_thread.run_sync(_start)
            return {"upload_id": upload_id, "key": key, "file_url": self._public_url(key)}
        except Exception as exc:
            logger.error("Failed to start multipart upload: bucket=%s key=%s error=%s", self.bucket, key, self._format_s3_error(exc, "CreateMultipartUpload"))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not start multipart upload",
            ) from exc

    async def get_multipart_part_url(self, key: str, upload_id: str, part_number: int, expires_in: int = 3600) -> str:
        if not self.bucket or not self._ensure_s3_ready():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="S3 is not configured")

        def _create() -> str:
            assert self.client is not None
            return self.client.generate_presigned_url(
                "upload_part",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "UploadId": upload_id,
                    "PartNumber": part_number,
                },
                ExpiresIn=expires_in,
            )

        try:
            return await to_thread.run_sync(_create)
        except Exception as exc:
            logger.error("Failed to create multipart part URL: bucket=%s key=%s upload_id=%s error=%s", self.bucket, key, upload_id, self._format_s3_error(exc, "UploadPart"))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not create multipart part upload URL",
            ) from exc

    async def complete_multipart_upload(self, key: str, upload_id: str, parts: list[dict]) -> str:
        if not self.bucket or not self._ensure_s3_ready():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="S3 is not configured")

        normalized_parts = [{"PartNumber": int(item["PartNumber"]), "ETag": item["ETag"]} for item in parts]
        normalized_parts.sort(key=lambda p: p["PartNumber"])

        def _complete() -> None:
            assert self.client is not None
            self.client.complete_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": normalized_parts},
            )

        try:
            await to_thread.run_sync(_complete)
            return self._public_url(key)
        except Exception as exc:
            logger.error("Failed to complete multipart upload: bucket=%s key=%s upload_id=%s error=%s", self.bucket, key, upload_id, self._format_s3_error(exc, "CompleteMultipartUpload"))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not finalize multipart upload",
            ) from exc

    async def abort_multipart_upload(self, key: str, upload_id: str) -> None:
        if not self.bucket:
            return
        if not self._ensure_s3_ready():
            return

        def _abort() -> None:
            assert self.client is not None
            self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=upload_id)

        try:
            await to_thread.run_sync(_abort)
        except Exception as exc:
            logger.error("Failed to abort multipart upload: bucket=%s key=%s upload_id=%s error=%s", self.bucket, key, upload_id, self._format_s3_error(exc, "AbortMultipartUpload"))

    async def get_object(self, key: str, range_header: str | None = None) -> dict:
        if self._is_local_upload(key):
            local_path = self._local_upload_path(key)
            if not local_path.exists():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
            return {
                "Body": _LocalBody(local_path),
                "ContentType": mimetypes.guess_type(local_path.name)[0] or "application/octet-stream",
                "ContentLength": local_path.stat().st_size,
            }

        if not self.bucket or not self._ensure_s3_ready():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="S3 is not configured")
        object_key = self._extract_key(key)

        def _get() -> dict:
            assert self.client is not None
            params: dict = {"Bucket": self.bucket, "Key": object_key}
            if range_header:
                params["Range"] = range_header
            return self.client.get_object(**params)

        try:
            return await to_thread.run_sync(_get)
        except Exception as exc:
            logger.error("Failed to fetch object from S3: bucket=%s key=%s error=%s", self.bucket, object_key, self._format_s3_error(exc, "GetObject"))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"S3 unavailable for this object",
            ) from exc

    async def create_thumbnail(self, content: bytes, mime_type: str, owner_id: str, folder_id: str | None = None) -> str | None:
        if not self.enabled or not self.client:
            return None

        mime = (mime_type or "").lower()
        folder_prefix = folder_id or "root"
        thumb_key = f"thumbnails/{owner_id}/{folder_prefix}/{uuid4().hex}.jpg"

        if mime.startswith("image/"):
            try:
                from PIL import Image  # type: ignore
            except Exception:
                return None

            def _thumb_image() -> str:
                _ = Image  # keep optional import local without lint churn
                return self._upload_thumbnail_bytes(self._render_image_thumbnail_bytes(content), thumb_key)

            return await to_thread.run_sync(_thumb_image)

        if mime.startswith("video/"):
            ffmpeg_bin = os.getenv("FFMPEG_PATH", "ffmpeg")
            tmp_in = Path(os.getenv("TMPDIR", ".")) / f"{uuid4().hex}.video"

            def _thumb_video() -> str | None:
                try:
                    tmp_in.write_bytes(content)
                    return self._create_video_thumbnail_from_source(str(tmp_in), thumb_key, ffmpeg_bin)
                except Exception:
                    return None
                finally:
                    if tmp_in.exists():
                        tmp_in.unlink(missing_ok=True)

            return await to_thread.run_sync(_thumb_video)

        return None

    async def create_thumbnail_from_storage(
        self,
        storage_path: str,
        mime_type: str,
        owner_id: str,
        folder_id: str | None = None,
    ) -> str | None:
        mime = (mime_type or "").lower()
        if not (mime.startswith("image/") or mime.startswith("video/")):
            return None

        if self._is_local_upload(storage_path):
            local_path = self._local_upload_path(storage_path)
            if not local_path.exists():
                return None
            content = await to_thread.run_sync(local_path.read_bytes)
            return await self.create_thumbnail(content, mime, owner_id, folder_id)

        if not self.enabled or not self.client:
            return None

        object_key = self._extract_key(storage_path)

        if mime.startswith("image/"):
            def _download_image() -> bytes:
                assert self.client is not None
                response = self.client.get_object(Bucket=self.bucket, Key=object_key)
                return response["Body"].read()

            content = await to_thread.run_sync(_download_image)
            return await self.create_thumbnail(content, mime, owner_id, folder_id)

        ffmpeg_bin = os.getenv("FFMPEG_PATH", "ffmpeg")
        thumb_key = f"thumbnails/{owner_id}/{folder_id or 'root'}/{uuid4().hex}.jpg"

        try:
            source_url = await self.get_presigned_get_url(object_key)
        except HTTPException:
            return None

        return await to_thread.run_sync(
            lambda: self._create_video_thumbnail_from_source(source_url, thumb_key, ffmpeg_bin)
        )

    async def upload_file(self, file, filename: str, owner_id: str, folder_id: str | None = None) -> str:
        content = file.read()
        return await self.upload_bytes(
            content=content,
            content_type="application/octet-stream",
            filename=filename,
            owner_id=owner_id,
            folder_id=folder_id,
        )

    async def delete_object(self, key: str) -> None:
        if self._is_local_upload(key):
            local_path = self._local_upload_path(key)
            local_path.unlink(missing_ok=True)
            return

        if key.startswith("mock://") or not self.bucket:
            return

        if not self._ensure_s3_ready():
            return
        object_key = self._extract_key(key)

        def _delete() -> None:
            assert self.client is not None
            self.client.delete_object(Bucket=self.bucket, Key=object_key)

        try:
            await to_thread.run_sync(_delete)
        except Exception as exc:
            logger.error("Failed to delete object from S3: bucket=%s key=%s error=%s", self.bucket, object_key, self._format_s3_error(exc, "DeleteObject"))
            # swallow error to avoid crashing
            return

    async def delete_file_from_s3(self, key: str) -> None:
        if self._is_local_upload(key):
            local_path = self._local_upload_path(key)
            local_path.unlink(missing_ok=True)
            return

        if key.startswith("mock://") or not self.bucket:
            return

        if not self._ensure_s3_ready():
            return
        object_key = self._extract_key(key)

        def _delete() -> None:
            assert self.client is not None
            self.client.delete_object(Bucket=self.bucket, Key=object_key)

        try:
            await to_thread.run_sync(_delete)
        except Exception as exc:
            logger.error("Failed to delete file from S3: bucket=%s key=%s error=%s", self.bucket, object_key, self._format_s3_error(exc, "DeleteObject"))
            return
