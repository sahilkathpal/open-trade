"""
GET    /api/schedules          — list all schedule entries for current user
DELETE /api/schedules/{id}     — remove a schedule entry (and its APScheduler job)
"""
from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_uid
from agent.schedule_manager import get_schedule_manager, _load_schedule, _save_schedule

router = APIRouter()


@router.get("/api/schedules")
def list_schedules(uid: str = Depends(get_current_uid)):
    """Return all scheduled job entries for the current user."""
    return _load_schedule(uid)


@router.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: str, uid: str = Depends(get_current_uid)):
    """Remove a scheduled job entry and its APScheduler job."""
    entries = _load_schedule(uid)
    before = len(entries)
    entries = [e for e in entries if e.get("id") != schedule_id]
    if len(entries) == before:
        raise HTTPException(status_code=404, detail=f"Schedule '{schedule_id}' not found")

    _save_schedule(uid, entries)

    mgr = get_schedule_manager()
    if mgr:
        mgr.remove_job(uid, schedule_id)

    return {"status": "removed", "schedule_id": schedule_id}
