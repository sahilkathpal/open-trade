import asyncio
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Ensure project root is in sys.path
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


async def main():
    # Initialize Firebase (no-op if not configured)
    from api.firebase_admin import init_firebase
    init_firebase()

    from agent.scheduler import setup_scheduler, set_telegram_sender

    # Start scheduler
    sched = setup_scheduler()
    sched.start()
    logger.info("Scheduler started (pre-market 08:45, heartbeat every 5m, EOD 15:35 IST)")

    # Telegram is optional
    telegram_app = None
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if bot_token:
        from agent.telegram import setup_telegram, send_message
        telegram_app = setup_telegram()
        set_telegram_sender(send_message)
        logger.info("Starting Telegram bot polling...")
        async with telegram_app:
            await telegram_app.initialize()
            await telegram_app.start()
            await telegram_app.updater.start_polling(allowed_updates=["message"])
            await send_message("Trading agent started. Type /start for help.")
            try:
                await asyncio.Event().wait()
            except (KeyboardInterrupt, SystemExit):
                pass
            finally:
                await telegram_app.updater.stop()
                await telegram_app.stop()
                await telegram_app.shutdown()
    else:
        logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram disabled")
        try:
            await asyncio.Event().wait()
        except (KeyboardInterrupt, SystemExit):
            pass

    sched.shutdown()
    logger.info("Shutdown complete.")


def entry():
    asyncio.run(main())


if __name__ == "__main__":
    entry()
