import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start scheduler + Telegram bot in the same process as the API server."""
    import os
    from agent.scheduler import setup_scheduler, set_telegram_sender
    from agent.tools import pending_approvals, place_trade

    sched = setup_scheduler()
    sched.start()
    logger.info("Scheduler started")

    # Telegram is optional — skip gracefully if token not configured
    telegram_app = None
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if bot_token:
        from agent.telegram import setup_telegram, send_message
        telegram_app = setup_telegram(
            pending_approvals=pending_approvals,
            place_trade_fn=place_trade,
        )
        set_telegram_sender(send_message)
        await telegram_app.initialize()
        await telegram_app.start()
        await telegram_app.updater.start_polling(allowed_updates=["message"])
        logger.info("Telegram bot polling started")
    else:
        logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled")

    yield  # serve requests

    # Shutdown
    if telegram_app:
        await telegram_app.updater.stop()
        await telegram_app.stop()
        await telegram_app.shutdown()
    sched.shutdown()
    logger.info("Shutdown complete")


app = FastAPI(title="open-trade API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

from api.routes import state, memory, actions, activity  # noqa: E402

app.include_router(state.router)
app.include_router(memory.router)
app.include_router(actions.router)
app.include_router(activity.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


def start():
    import uvicorn
    uvicorn.run("api.server:app", host="0.0.0.0", port=8000, reload=False)
