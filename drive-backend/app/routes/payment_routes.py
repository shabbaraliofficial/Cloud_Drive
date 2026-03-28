from __future__ import annotations

from datetime import datetime
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.core import config
from app.database.mongodb import get_database
from app.routes.deps import get_current_user
from app.utils.plans import PAID_PLANS, build_plan_update, get_plan_config, normalize_plan
from app.utils.storage import sync_user_storage_usage

try:
    import razorpay
except ImportError:  # pragma: no cover - protected so existing APIs keep working without the SDK
    razorpay = None

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Payments"])


class CreateOrderRequest(BaseModel):
    plan: str


class VerifyPaymentRequest(BaseModel):
    payment_id: str
    order_id: str
    plan: str


def _get_razorpay_client():
    if razorpay is None:
        raise ValueError("Razorpay SDK is not installed on the backend")

    def _clean(value: str | None) -> str:
        return str(value or "").strip().strip('"').strip("'").strip()

    key_id = _clean(config.RAZORPAY_KEY_ID)
    key_secret = _clean(config.RAZORPAY_KEY_SECRET)

    if not key_id or not key_secret:
        raise ValueError("Razorpay keys not configured properly (check drive-backend/.env)")

    if key_id == "your_test_key" or key_secret == "your_test_secret":
        raise ValueError("Replace placeholder Razorpay keys with real TEST MODE credentials")

    if not key_id.startswith("rzp_test_"):
        raise ValueError("Use Razorpay TEST MODE key id starting with rzp_test_")

    return razorpay.Client(auth=(key_id, key_secret))


@router.post("/api/create-order", response_model=dict)
async def create_order(
    payload: CreateOrderRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    plan = normalize_plan(payload.plan)
    if plan not in PAID_PLANS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only Basic and Pro plans can be purchased")

    plan_config = get_plan_config(plan)
    # Razorpay requires receipt length <= 40 characters.
    receipt = f"rcpt_{plan}_{uuid.uuid4().hex[:20]}"

    try:
        client = _get_razorpay_client()
        order = client.order.create(
            {
                "amount": int(plan_config["amount_paise"]),
                "currency": "INR",
                "payment_capture": 1,
                "receipt": receipt,
                "notes": {
                    "user_id": str(current_user["_id"]),
                    "plan": plan,
                },
            }
        )
    except Exception as exc:  # pragma: no cover - network call
        logger.exception("Razorpay order creation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc) or "Unable to create Razorpay order",
        ) from exc

    return {
        "order_id": order["id"],
        "amount": int(plan_config["amount_paise"]),
        "currency": order.get("currency", "INR"),
    }


@router.post("/api/verify-payment", response_model=dict)
async def verify_payment(
    payload: VerifyPaymentRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
) -> dict:
    plan = normalize_plan(payload.plan)
    if plan not in PAID_PLANS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid paid plan selected")

    plan_update = build_plan_update(plan)
    plan_config = get_plan_config(plan)
    now = datetime.utcnow()

    await db.users.update_one(
        {"_id": current_user["_id"]},
        {
            "$set": {
                **plan_update,
                "updated_at": now,
            }
        },
    )

    refreshed_user = await db.users.find_one({"_id": current_user["_id"]})
    if not refreshed_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    storage = await sync_user_storage_usage(
        db,
        refreshed_user,
        int(refreshed_user.get("storage_used", 0) or 0),
        total=int(plan_update["storage_limit"]),
    )

    await db.payments.insert_one(
        {
            "user_id": current_user["_id"],
            "payment_id": payload.payment_id,
            "order_id": payload.order_id,
            "plan": plan,
            "amount": int(plan_config["amount_paise"]),
            "status": "paid",
            "is_test_mode": True,
            "created_at": now,
            "updated_at": now,
        }
    )

    return {
        "message": "Payment verified successfully",
        "plan": plan,
        "is_premium": bool(plan_update["is_premium"]),
        "storage_limit": storage["total"],
    }
