from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

router = APIRouter()
MEMORY_DIR = Path("memory")
ALLOWED = {"MARKET.md", "STRATEGY.md", "JOURNAL.md", "HEARTBEAT.md", "SOUL.md"}

@router.get("/api/memory/{filename}")
def read_memory_file(filename: str):
    if filename not in ALLOWED:
        raise HTTPException(status_code=404, detail=f"{filename} not in allowed list")
    path = MEMORY_DIR / filename
    if not path.exists():
        return {"filename": filename, "content": "", "last_modified": None}
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    return {"filename": filename, "content": path.read_text(), "last_modified": mtime}
