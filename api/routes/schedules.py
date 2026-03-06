"""
GET    /api/schedules          — list all schedule entries for current user
DELETE /api/schedules/{id}     — remove a schedule entry (and its APScheduler job)
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated

from api.auth import get_current_uid
from agent.schedule_manager import get_schedule_manager, _load_schedule, _save_schedule

router = APIRouter()


def _list_user_schedules(uid: str) -> list:
    """Read schedules from Firestore first, fall back to file."""
    try:
        from agent.firestore_strategies import get_all_schedules
        schedules = get_all_schedules(uid)
        if schedules:
            return schedules
    except Exception:
        pass
    return _load_schedule(uid)


@router.get("/api/schedules")
def list_schedules(uid: Annotated[str, Depends(get_current_uid)]):
    """Return all scheduled job entries for the current user."""
    return _list_user_schedules(uid)


@router.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: str, uid: Annotated[str, Depends(get_current_uid)]):
    """Remove a scheduled job entry and its APScheduler job."""
    found = False

    # Remove from Firestore
    try:
        from agent.firestore_strategies import get_all_schedules, delete_strategy_schedule
        all_schedules = get_all_schedules(uid)
        for entry in all_schedules:
            if entry.get("id") == schedule_id:
                sid = entry.get("strategy_id", "untagged")
                delete_strategy_schedule(uid, sid, schedule_id)
                found = True
                break
    except Exception:
        pass

    # Remove from file fallback
    entries = _load_schedule(uid)
    before = len(entries)
    entries = [e for e in entries if e.get("id") != schedule_id]
    if len(entries) < before:
        found = True
        _save_schedule(uid, entries)

    if not found:
        raise HTTPException(status_code=404, detail=f"Schedule '{schedule_id}' not found")

    mgr = get_schedule_manager()
    if mgr:
        mgr.remove_job(uid, schedule_id)

    return {"status": "removed", "schedule_id": schedule_id}
