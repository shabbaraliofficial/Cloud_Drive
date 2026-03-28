from __future__ import annotations
from pydantic import BaseModel


class StorageUsageResponse(BaseModel):
    used: int
    total: int
    remaining: int
    used_bytes: int
    quota_bytes: int
    available_bytes: int
    used_percent: float


