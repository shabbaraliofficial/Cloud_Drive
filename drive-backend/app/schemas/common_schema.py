from __future__ import annotations
from datetime import datetime

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


