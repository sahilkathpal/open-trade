from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_uid

router = APIRouter()

# Shared files readable by all users
_SHARED = {"SOUL.md", "HEARTBEAT.md"}

# Internal files excluded from the docs listing
_INTERNAL_MD = {"ACTIVITY.md", "STRATEGY_SUMMARY.md"}


def _user_memory_dir(uid: str) -> Path:
    from api.routes.state import _set_user_ctx_for_uid
    from agent.user_context import reset_user_ctx
    token, ctx = _set_user_ctx_for_uid(uid)
    reset_user_ctx(token)
    return ctx.memory_dir


def _safe_filename(filename: str) -> bool:
    """Reject path traversal and non-.md files."""
    return (
        filename.endswith(".md")
        and "/" not in filename
        and "\\" not in filename
        and ".." not in filename
    )


@router.get("/api/memory")
def list_memory_files(uid: Annotated[str, Depends(get_current_uid)]):
    """List all .md files in the user's memory directory."""
    memory_dir = _user_memory_dir(uid)
    files = []
    if memory_dir.exists():
        for path in sorted(memory_dir.glob("*.md")):
            if path.name in _INTERNAL_MD:
                continue
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
            files.append({"filename": path.name, "last_modified": mtime})
    return files


@router.get("/api/memory/{filename}")
def read_memory_file(
    filename: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if filename in _SHARED:
        path = Path("memory") / filename
    else:
        memory_dir = _user_memory_dir(uid)
        path = memory_dir / filename

    if not path.exists():
        return {"filename": filename, "content": "", "last_modified": None}

    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    return {"filename": filename, "content": path.read_text(), "last_modified": mtime}
