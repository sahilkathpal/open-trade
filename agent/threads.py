"""
Per-user, per-strategy thread storage.

JSONL format — one JSON line per message, append-only.
Metadata in a separate .meta.json file for fast listing.

Layout:
  memory/{uid}/threads/{strategy}/{threadId}.jsonl
  memory/{uid}/threads/{strategy}/{threadId}.meta.json
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytz


def _threads_dir(strategy: str) -> Path:
    from agent.user_context import get_user_ctx
    mem = get_user_ctx().memory_dir
    d = mem / "threads" / strategy
    d.mkdir(parents=True, exist_ok=True)
    return d


def create_thread(strategy: str) -> dict:
    """Create a new empty thread. Returns metadata dict."""
    thread_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    meta = {
        "id": thread_id,
        "strategy": strategy,
        "title": "New thread",
        "created_at": now,
        "status": "idle",
    }
    d = _threads_dir(strategy)
    (d / f"{thread_id}.jsonl").touch()
    (d / f"{thread_id}.meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def get_thread_meta(strategy: str, thread_id: str) -> dict | None:
    d = _threads_dir(strategy)
    meta_path = d / f"{thread_id}.meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def list_threads(strategy: str) -> list[dict]:
    """List all threads for a strategy, sorted by created_at descending."""
    d = _threads_dir(strategy)
    metas = []
    for f in d.glob("*.meta.json"):
        try:
            metas.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return sorted(metas, key=lambda m: m.get("created_at", ""), reverse=True)


def append_message(strategy: str, thread_id: str, role: str, content: str):
    """Append one message to the thread's JSONL file."""
    now = datetime.now(pytz.timezone("Asia/Kolkata")).isoformat()
    line = json.dumps({"role": role, "content": content, "ts": now})
    d = _threads_dir(strategy)
    with open(d / f"{thread_id}.jsonl", "a", encoding="utf-8") as f:
        f.write(line + "\n")
    # Update title from first user message
    if role == "user":
        meta = get_thread_meta(strategy, thread_id)
        if meta and meta.get("title") == "New thread":
            title = content[:60].replace("\n", " ")
            meta["title"] = title
            (d / f"{thread_id}.meta.json").write_text(
                json.dumps(meta), encoding="utf-8"
            )


def get_messages(strategy: str, thread_id: str) -> list[dict]:
    """Read all messages from the thread's JSONL file."""
    d = _threads_dir(strategy)
    path = d / f"{thread_id}.jsonl"
    if not path.exists():
        return []
    messages = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            messages.append(json.loads(line))
        except Exception:
            pass
    return messages


def set_status(strategy: str, thread_id: str, status: str):
    """Update the status field in the thread's metadata."""
    d = _threads_dir(strategy)
    meta_path = d / f"{thread_id}.meta.json"
    if not meta_path.exists():
        return
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["status"] = status
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
    except Exception:
        pass
