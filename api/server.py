import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start Firebase, scheduler + Telegram bot in the same process as the API server."""
    import os

    # Initialize Firebase Admin (no-op if FIREBASE_SERVICE_ACCOUNT_KEY not set)
    from api.firebase_admin import init_firebase
    init_firebase()

    from agent.scheduler import setup_scheduler, set_telegram_sender
    from agent.telegram import set_event_loop
    set_event_loop(asyncio.get_event_loop())

    sched = setup_scheduler()
    sched.start()
    logger.info("Scheduler started")

    # Telegram is optional
    telegram_app = None
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    logger.info("Telegram token present: %s", bool(bot_token))
    if bot_token:
        from agent.telegram import setup_telegram, send_message, _COMMANDS
        from telegram import BotCommand
        from telegram.error import Conflict
        logger.info("Starting Telegram bot...")

        for attempt in range(6):
            logger.info("Telegram attempt %d", attempt + 1)
            try:
                telegram_app = setup_telegram()
                set_telegram_sender(send_message)
                await telegram_app.initialize()
                await telegram_app.start()
                await telegram_app.updater.start_polling(
                    allowed_updates=["message"],
                    drop_pending_updates=True,
                )
                await telegram_app.bot.set_my_commands(
                    [BotCommand(cmd, desc) for cmd, desc in _COMMANDS]
                )
                logger.info("Telegram bot polling started")
                break
            except Conflict:
                wait = 10 * (attempt + 1)
                logger.warning("Telegram conflict on attempt %d — waiting %ds for previous session to expire", attempt + 1, wait)
                try:
                    await telegram_app.shutdown()
                except Exception:
                    pass
                telegram_app = None
                await asyncio.sleep(wait)
            except Exception as e:
                wait = 10 * (attempt + 1)
                logger.warning("Telegram attempt %d failed (%s: %s) — retrying in %ds", attempt + 1, type(e).__name__, e, wait)
                try:
                    await telegram_app.shutdown()
                except Exception:
                    pass
                telegram_app = None
                await asyncio.sleep(wait)
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


app = FastAPI(title="open-trade API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

from api.routes import state, memory, actions, activity, settings as settings_route, chat  # noqa: E402

app.include_router(state.router)
app.include_router(memory.router)
app.include_router(actions.router)
app.include_router(activity.router)
app.include_router(settings_route.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


def start():
    import uvicorn
    uvicorn.run("api.server:app", host="0.0.0.0", port=8000, reload=False)
