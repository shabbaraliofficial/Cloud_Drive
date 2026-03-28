from __future__ import annotations

GB_IN_BYTES = 1024 ** 3

FREE_PLAN = "free"
BASIC_PLAN = "basic"
PRO_PLAN = "pro"

PLAN_CONFIGS = {
    FREE_PLAN: {
        "id": FREE_PLAN,
        "label": "Free",
        "storage_limit_gb": 10,
        "storage_limit_bytes": 10 * GB_IN_BYTES,
        "amount_paise": 0,
        "is_premium": False,
    },
    BASIC_PLAN: {
        "id": BASIC_PLAN,
        "label": "Basic",
        "storage_limit_gb": 50,
        "storage_limit_bytes": 50 * GB_IN_BYTES,
        "amount_paise": 9900,
        "is_premium": True,
    },
    PRO_PLAN: {
        "id": PRO_PLAN,
        "label": "Pro",
        "storage_limit_gb": 200,
        "storage_limit_bytes": 200 * GB_IN_BYTES,
        "amount_paise": 29900,
        "is_premium": True,
    },
}

PAID_PLANS = {BASIC_PLAN, PRO_PLAN}


def normalize_plan(plan: str | None) -> str:
    normalized = str(plan or FREE_PLAN).strip().lower()
    if normalized not in PLAN_CONFIGS:
        return FREE_PLAN
    return normalized


def get_plan_config(plan: str | None) -> dict:
    return PLAN_CONFIGS[normalize_plan(plan)]


def get_plan_storage_limit_bytes(plan: str | None) -> int:
    return int(get_plan_config(plan)["storage_limit_bytes"])


def infer_plan_from_user(user: dict | None) -> str:
    if not user:
        return FREE_PLAN

    raw_plan = normalize_plan(user.get("plan"))
    if raw_plan in PLAN_CONFIGS and user.get("plan"):
        return raw_plan

    account_type = str(user.get("account_type") or "").strip().lower()
    if account_type in PLAN_CONFIGS:
        return account_type

    try:
        storage_limit = int(user.get("storage_limit") or 0)
    except (TypeError, ValueError):
        storage_limit = 0

    for plan_id, config in PLAN_CONFIGS.items():
        if storage_limit == int(config["storage_limit_bytes"]):
            return plan_id

    return FREE_PLAN


def build_plan_update(plan: str | None) -> dict:
    config = get_plan_config(plan)
    return {
        "plan": config["id"],
        "storage_limit": int(config["storage_limit_bytes"]),
        "account_type": config["label"],
        "is_premium": bool(config["is_premium"]),
    }
