from __future__ import annotations

from pathlib import Path

IMAGE_FILENAME_RULES = {
    "person": ["person"],
    "car": ["car"],
    "nature": ["nature", "forest", "mountain", "beach"],
}

DOCUMENT_FILENAME_RULES = {
    "resume": ["resume", "cv"],
    "invoice": ["invoice", "bill"],
}


def _append_unique(tags: list[str], value: str) -> None:
    if value not in tags:
        tags.append(value)


def generate_file_tags(filename: str | None, mime_type: str | None) -> list[str]:
    lower_name = Path(filename or "").name.lower()
    lower_mime = (mime_type or "").lower()
    tags: list[str] = []

    if lower_mime.startswith("image/"):
        _append_unique(tags, "image")
        for tag, keywords in IMAGE_FILENAME_RULES.items():
            if any(keyword in lower_name for keyword in keywords):
                _append_unique(tags, tag)

    if lower_mime.startswith("video/"):
        _append_unique(tags, "video")

    if lower_mime.startswith("text/"):
        _append_unique(tags, "text")

    if "pdf" in lower_mime or lower_name.endswith(".pdf"):
        _append_unique(tags, "document")
        _append_unique(tags, "pdf")

    if any(keyword in lower_name for keyword in DOCUMENT_FILENAME_RULES["resume"]):
        _append_unique(tags, "resume")

    if any(keyword in lower_name for keyword in DOCUMENT_FILENAME_RULES["invoice"]):
        _append_unique(tags, "invoice")

    if not tags:
        _append_unique(tags, "file")

    return tags
