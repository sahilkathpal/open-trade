import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

_lock = threading.Lock()
_buffer: deque[dict] = deque(maxlen=200)
_subscribers: list[Any] = []  # asyncio queues for SSE

def emit(event: dict):
    """Add an event to the buffer and push to all SSE subscribers."""
    event = {"ts": datetime.now(timezone.utc).isoformat(), **event}
    with _lock:
        _buffer.append(event)
        for q in list(_subscribers):
            try:
                q.put_nowait(event)
            except Exception:
                pass

def get_recent() -> list[dict]:
    with _lock:
        return list(_buffer)

def subscribe(q):
    with _lock:
        _subscribers.append(q)

def unsubscribe(q):
    with _lock:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass
