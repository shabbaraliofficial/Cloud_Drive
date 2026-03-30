from __future__ import annotations

import re
from datetime import datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.utils.query_helpers import combine_filters


def _normalize_text(value: str | None) -> str:
    return (value or "").strip()


def _normalize_slug(value: str | None) -> str:
    return _normalize_text(value).lower().replace("-", "_").replace(" ", "_")


def _escape_pattern(value: str | None) -> str:
    return re.escape(_normalize_text(value))


def _regex_field_filter(*field_names: str, value: str) -> dict | None:
    pattern = _escape_pattern(value)
    if not pattern:
        return None
    return {
        "$or": [
            {field_name: {"$regex": pattern, "$options": "i"}}
            for field_name in field_names
        ]
    }


def _merge_optional_filters(*filters: dict | None) -> dict | None:
    merged = combine_filters(*filters)
    return merged or None


def build_file_name_filter(name: str | None) -> dict | None:
    return _regex_field_filter("file_name", "filename", "tags", value=name or "")


def build_folder_name_filter(name: str | None) -> dict | None:
    return _regex_field_filter("name", value=name or "")


def build_includes_words_filter(value: str | None) -> dict | None:
    terms = [re.escape(term) for term in _normalize_text(value).split() if term]
    if not terms:
        return None
    return {
        "$and": [
            {
                "$or": [
                    {"file_name": {"$regex": term, "$options": "i"}},
                    {"filename": {"$regex": term, "$options": "i"}},
                    {"content": {"$regex": term, "$options": "i"}},
                    {"text_content": {"$regex": term, "$options": "i"}},
                    {"extracted_text": {"$regex": term, "$options": "i"}},
                    {"ocr_text": {"$regex": term, "$options": "i"}},
                    {"summary": {"$regex": term, "$options": "i"}},
                    {"tags": {"$regex": term, "$options": "i"}},
                ]
            }
            for term in terms
        ]
    }


def build_search_type_query(file_type: str | None) -> dict | None:
    normalized = _normalize_slug(file_type)
    if not normalized or normalized in {"all", "any"}:
        return None
    if normalized == "image":
        return {"mime_type": {"$regex": r"^image/", "$options": "i"}}
    if normalized == "video":
        return {"mime_type": {"$regex": r"^video/", "$options": "i"}}
    if normalized == "pdf":
        return {
            "$or": [
                {"mime_type": {"$regex": "pdf", "$options": "i"}},
                {"file_type": {"$regex": "pdf", "$options": "i"}},
                {"file_name": {"$regex": r"\.pdf$", "$options": "i"}},
                {"filename": {"$regex": r"\.pdf$", "$options": "i"}},
                {"tags": {"$regex": "pdf|document", "$options": "i"}},
            ]
        }
    if normalized in {"document", "documents", "doc", "docs"}:
        return {
            "$or": [
                {"mime_type": {"$regex": r"(pdf|msword|officedocument|text/)", "$options": "i"}},
                {"file_type": {"$regex": r"(pdf|msword|officedocument|text/)", "$options": "i"}},
                {"file_name": {"$regex": r"\.(pdf|doc|docx|txt|rtf|odt|ppt|pptx|xls|xlsx)$", "$options": "i"}},
                {"filename": {"$regex": r"\.(pdf|doc|docx|txt|rtf|odt|ppt|pptx|xls|xlsx)$", "$options": "i"}},
                {"tags": {"$regex": r"(document|pdf|resume|invoice)", "$options": "i"}},
            ]
        }
    return {
        "$or": [
            {"mime_type": {"$regex": re.escape(normalized), "$options": "i"}},
            {"file_type": {"$regex": re.escape(normalized), "$options": "i"}},
            {"tags": {"$regex": re.escape(normalized), "$options": "i"}},
        ]
    }


def build_owner_filter(owner: str | None, user_id) -> dict | None:
    normalized = _normalize_slug(owner)
    if normalized in {"", "any", "anyone"}:
        return None
    if normalized == "me":
        return {"owner_id": user_id}
    if normalized == "others":
        return {"owner_id": {"$ne": user_id}}
    return None


def build_location_filter(location: str | None, item_kind: str = "file") -> dict | None:
    normalized = _normalize_slug(location)
    if normalized in {"", "any", "anywhere"}:
        return None

    if normalized == "drive":
        normalized = "my_drive"

    if item_kind == "folder":
        if normalized == "my_drive":
            return {
                "$and": [
                    {
                        "$or": [
                            {"parent_folder_id": None},
                            {"parent_folder_id": {"$exists": False}},
                        ]
                    },
                    {
                        "$or": [
                            {"parent_folder": None},
                            {"parent_folder": {"$exists": False}},
                        ]
                    },
                ]
            }
        if normalized == "folder":
            return {
                "$or": [
                    {"parent_folder_id": {"$exists": True, "$ne": None}},
                    {"parent_folder": {"$exists": True, "$ne": None}},
                ]
            }
        return None

    if normalized == "my_drive":
        return {"folder_id": None}
    if normalized == "folder":
        return {"folder_id": {"$exists": True, "$ne": None}}
    return None


def build_starred_filter(starred: bool | None) -> dict | None:
    if starred is True:
        return {"is_starred": True}
    return None


def build_encrypted_filter(encrypted: bool | None) -> dict | None:
    if encrypted is True:
        return {
            "$or": [
                {"is_encrypted": True},
                {"encrypted": True},
            ]
        }
    return None


def build_date_range_filter(
    date_from: datetime | None,
    date_to: datetime | None,
    *,
    field_name: str,
) -> dict | None:
    if not date_from and not date_to:
        return None
    range_filter: dict = {}
    if date_from:
        range_filter["$gte"] = date_from
    if date_to:
        range_filter["$lte"] = date_to
    return {field_name: range_filter}


def build_date_modified_filter(date_modified: str | None) -> dict | None:
    normalized = _normalize_slug(date_modified)
    if normalized in {"", "any_time", "any"}:
        return None

    now = datetime.utcnow()
    if normalized == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif normalized == "last_7_days":
        start = now - timedelta(days=7)
    elif normalized == "last_30_days":
        start = now - timedelta(days=30)
    else:
        return None

    return {"updated_at": {"$gte": start, "$lte": now}}


async def build_shared_to_filter(
    db: AsyncIOMotorDatabase,
    *,
    shared_to: str | None,
    owner_id,
) -> dict | None:
    email = _normalize_text(shared_to)
    if not email:
        return None

    user = await db.users.find_one(
        {
            "email": {
                "$regex": f"^{re.escape(email)}$",
                "$options": "i",
            }
        },
        {"_id": 1},
    )
    if not user:
        return {"_id": {"$exists": False}}

    return {
        "$and": [
            {"owner_id": owner_id},
            {
                "$or": [
                    {"share_entries": {"$elemMatch": {"user_id": user["_id"]}}},
                    {"shared_with": user["_id"]},
                ]
            },
        ]
    }


def build_file_text_filter(*, name: str | None, includes_words: str | None) -> dict | None:
    return _merge_optional_filters(
        build_file_name_filter(name),
        build_includes_words_filter(includes_words),
    )


def should_include_folder_results(
    *,
    file_type: str | None,
    includes_words: str | None,
    encrypted: bool | None,
) -> bool:
    return (
        build_search_type_query(file_type) is None
        and not _normalize_text(includes_words)
        and encrypted is not True
    )
