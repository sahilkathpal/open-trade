import asyncio
import logging
from datetime import datetime

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

IST = pytz.timezone("Asia/Kolkata")

# Will be set by main.py / server.py so scheduler can send Telegram notifications
_send_telegram = None

scheduler = AsyncIOScheduler(timezone=IST)


def set_telegram_sender(fn):
    """Register the Telegram send function so scheduler can notify."""
    global _send_telegram
    _send_telegram = fn


def _is_market_open() -> bool:
    from agent.tools import is_trading_day
    now = datetime.now(IST)
    if not is_trading_day(now.date()):
        return False
    market_open  = now.replace(hour=9,  minute=15, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return market_open <= now <= market_close


async def _for_each_user(job_fn):
    """
    Run job_fn(ctx) for every registered user (multi-tenant).
    Falls back to single-user env-var mode if Firestore is not configured.
    """
    from agent.user_context import UserContext, set_user_ctx, reset_user_ctx, _get_default_ctx
    from agent.firestore import is_enabled, get_all_users

    if not is_enabled():
        ctx = _get_default_ctx()
        token = set_user_ctx(ctx)
        try:
            await job_fn(ctx)
        finally:
            reset_user_ctx(token)
        return

    users = get_all_users()
    if not users:
        logger.warning("No users found in Firestore — skipping job")
        return

    for user_doc in users:
        uid = user_doc.get("uid", "unknown")
        if user_doc.get("paused"):
            logger.info("User %s is paused — skipping", uid)
            continue
        try:
            ctx = UserContext(uid, user_doc)
        except Exception as e:
            logger.error("Failed to create UserContext for %s: %s", uid, e)
            continue
        token = set_user_ctx(ctx)
        try:
            await job_fn(ctx)
        except Exception as e:
            logger.error("Job failed for user %s: %s", uid, e, exc_info=True)
        finally:
            reset_user_ctx(token)


async def run_heartbeat():
    """Every 5 minutes — position monitoring during market hours. Pure Python, no LLM."""
    if not _is_market_open():
        return

    logger.debug("Running heartbeat...")

    async def _run(ctx):
        try:
            from agent.heartbeat import run as heartbeat_run
            result = await asyncio.to_thread(heartbeat_run)
            if result.strip() == "HEARTBEAT_OK":
                logger.debug("Heartbeat OK for %s", ctx.uid)
                return
            logger.info("Heartbeat action for %s: %s", ctx.uid, result)
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(f"Heartbeat\n\n{result}", chat_id=ctx.telegram_chat_id)
        except Exception as e:
            logger.error("Heartbeat failed for %s: %s", ctx.uid, e, exc_info=True)
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(f"Heartbeat error: {e}", chat_id=ctx.telegram_chat_id)

    await _for_each_user(_run)


def setup_scheduler():
    """
    Register the heartbeat default job and load all users' Claude-owned schedules.

    Only the heartbeat runs as infrastructure. All other jobs (premarket, execution,
    eod, custom) are created by Claude via write_schedule() and stored in
    memory/{uid}/SCHEDULE.json.
    """
    from agent.schedule_manager import ScheduleManager, set_schedule_manager
    from agent.firestore import is_enabled, get_all_users
    from agent.user_context import _get_default_ctx

    # Heartbeat default: minimum cadence, always running.
    # If a user's SCHEDULE.json has job_type="heartbeat", it overrides this cadence.
    scheduler.add_job(
        run_heartbeat, "interval",
        minutes=1,
        id="heartbeat", replace_existing=True,
    )

    # Create ScheduleManager and register it as singleton
    mgr = ScheduleManager(scheduler)
    set_schedule_manager(mgr)

    # Load Claude-owned schedules for all users
    if is_enabled():
        try:
            users = get_all_users()
            for user_doc in users:
                uid = user_doc.get("uid")
                if uid:
                    mgr.load_user_schedules(uid)
        except Exception as e:
            logger.warning("Could not load user schedules from Firestore: %s", e)
    else:
        # Single-user fallback: load default user schedules
        try:
            ctx = _get_default_ctx()
            mgr.load_user_schedules(ctx.uid)
        except Exception as e:
            logger.warning("Could not load default user schedules: %s", e)

    return scheduler
