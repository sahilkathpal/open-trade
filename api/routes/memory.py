from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_uid

router = APIRouter()

ALLOWED = {"MARKET.md", "STRATEGY.md", "JOURNAL.md", "HEARTBEAT.md", "SOUL.md"}
# These files are shared across all users
_SHARED = {"SOUL.md", "HEARTBEAT.md"}


@router.get("/api/memory/{filename}")
def read_memory_file(
    filename: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    if filename not in ALLOWED:
        raise HTTPException(status_code=404, detail=f"{filename} not in allowed list")

    if filename in _SHARED:
        path = Path("memory") / filename
    else:
        from api.routes.state import _set_user_ctx_for_uid
        from agent.user_context import reset_user_ctx
        token, ctx = _set_user_ctx_for_uid(uid)
        reset_user_ctx(token)
        path = ctx.memory_dir / filename

    if not path.exists():
        return {"filename": filename, "content": "", "last_modified": None}

    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    return {"filename": filename, "content": path.read_text(), "last_modified": mtime}
