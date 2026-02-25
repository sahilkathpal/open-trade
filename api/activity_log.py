import asyncio
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

_lock = threading.Lock()
_buffer: deque[dict] = deque(maxlen=200)
_subscribers: list[tuple[Any, Any]] = []  # (queue, loop) pairs

def emit(event: dict):
    """Add an event to the buffer and push to all SSE subscribers.

    emit() may be called from a thread-pool executor (agent runner), so we
    must use call_soon_threadsafe() to safely enqueue onto each subscriber's
    asyncio event loop instead of calling put_nowait() directly.
    """
    event = {"ts": datetime.now(timezone.utc).isoformat(), **event}
    with _lock:
        _buffer.append(event)
        for q, loop in list(_subscribers):
            try:
                loop.call_soon_threadsafe(q.put_nowait, event)
            except Exception:
                pass

def get_recent() -> list[dict]:
    with _lock:
        return list(_buffer)

def subscribe(q):
    """Subscribe an asyncio.Queue, capturing the current event loop."""
    loop = asyncio.get_event_loop()
    with _lock:
        _subscribers.append((q, loop))

def unsubscribe(q):
    with _lock:
        _subscribers[:] = [(sq, loop) for sq, loop in _subscribers if sq is not q]
