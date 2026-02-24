import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from api.activity_log import get_recent, subscribe, unsubscribe

router = APIRouter()

@router.get("/api/activity")
async def activity_stream():
    queue = asyncio.Queue()
    subscribe(queue)

    async def event_generator():
        try:
            # First: send all buffered events
            for event in get_recent():
                yield f"data: {json.dumps(event)}\n\n"
            # Then: stream new events as they arrive
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"type\": \"ping\"}\n\n"
        finally:
            unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )
