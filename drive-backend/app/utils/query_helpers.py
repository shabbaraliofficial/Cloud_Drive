from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.utils.access_control import build_active_file_share_query, build_active_folder_share_query


def combine_filters(*filters: dict | None) -> dict:
    active_filters = [item for item in filters if item]
    if not active_filters:
        return {}
    if len(active_filters) == 1:
        return active_filters[0]
    return {"$and": active_filters}


async def get_accessible_shared_folder_ids(
    db: AsyncIOMotorDatabase,
    user_id,
) -> list:
    root_docs = await db.folders.find(
        {
            "owner_id": {"$ne": user_id},
            "is_deleted": {"$ne": True},
            **build_active_folder_share_query(user_id),
        },
        {"_id": 1},
    ).to_list(1000)

    accessible_ids = {item["_id"] for item in root_docs if item.get("_id")}
    queue = list(accessible_ids)

    while queue:
        batch = queue[:100]
        queue = queue[100:]
        children = await db.folders.find(
            {
                "owner_id": {"$ne": user_id},
                "is_deleted": {"$ne": True},
                "$or": [
                    {"parent_folder_id": {"$in": batch}},
                    {"parent_folder": {"$in": batch}},
                ],
            },
            {"_id": 1},
        ).to_list(1000)

        for child in children:
            child_id = child.get("_id")
            if not child_id or child_id in accessible_ids:
                continue
            accessible_ids.add(child_id)
            queue.append(child_id)

    return list(accessible_ids)


async def build_accessible_folder_query(
    db: AsyncIOMotorDatabase,
    user_id,
    *extra_filters: dict | None,
    deleted_mode: str = "active",
) -> dict:
    shared_folder_ids = await get_accessible_shared_folder_ids(db, user_id)
    access_filters: list[dict] = [{"owner_id": user_id}]
    if shared_folder_ids:
        access_filters.append({"_id": {"$in": shared_folder_ids}})

    deleted_filter = {"is_deleted": True} if deleted_mode == "only" else {"is_deleted": {"$ne": True}}

    return combine_filters(
        deleted_filter,
        {"$or": access_filters},
        *extra_filters,
    )


async def build_accessible_file_query(
    db: AsyncIOMotorDatabase,
    user_id,
    *extra_filters: dict | None,
    deleted_mode: str = "active",
) -> dict:
    shared_folder_ids = await get_accessible_shared_folder_ids(db, user_id)
    access_filters: list[dict] = [
        {"owner_id": user_id},
        build_active_file_share_query(user_id),
    ]
    if shared_folder_ids:
        access_filters.append(
            {
                "owner_id": {"$ne": user_id},
                "folder_id": {"$in": shared_folder_ids},
            }
        )

    deleted_filter = {"is_deleted": True} if deleted_mode == "only" else {"is_deleted": {"$ne": True}}

    return combine_filters(
        deleted_filter,
        {"$or": access_filters},
        *extra_filters,
    )
