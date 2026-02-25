import asyncio
import logging
from datetime import datetime

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from agent.runner import run
from agent.tools import get_pending_approvals, save_pending_approvals, _save_watchlist, _save_triggers, reset_agent_pnl

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
    now = datetime.now(IST)
    if now.weekday() > 4:
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


async def run_premarket():
    """8:45 AM IST — deep pre-market analysis."""
    logger.info("Running pre-market analysis...")

    async def _run(ctx):
        # Clear stale proposals, watchlist, triggers, and P&L from previous day
        save_pending_approvals({})
        _save_watchlist({})
        _save_triggers([])
        reset_agent_pnl()
        try:
            result = await asyncio.to_thread(run, "premarket")
            if _send_telegram:
                await _send_telegram(
                    f"Pre-market complete\n\n{result[:1000]}...",
                    chat_id=ctx.telegram_chat_id,
                )
        except Exception as e:
            logger.error("Pre-market job failed for %s: %s", ctx.uid, e, exc_info=True)
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(f"Pre-market job failed: {e}", chat_id=ctx.telegram_chat_id)

    await _for_each_user(_run)


async def run_execution():
    """9:35 AM IST — first candle closed, set entry levels and propose trades."""
    logger.info("Running execution planning...")

    async def _run(ctx):
        try:
            result = await asyncio.to_thread(run, "execution")
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(
                    f"Execution plan ready\n\n{result[:1000]}",
                    chat_id=ctx.telegram_chat_id,
                )
        except Exception as e:
            logger.error("Execution job failed for %s: %s", ctx.uid, e, exc_info=True)
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(f"Execution job failed: {e}", chat_id=ctx.telegram_chat_id)

    await _for_each_user(_run)


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


async def clear_proposals():
    """3:20 PM IST — MIS auto-square-off. Clear all stale intraday proposals."""

    async def _run(ctx):
        pending = get_pending_approvals()
        cleared = list(pending.keys())
        if cleared:
            save_pending_approvals({})
            logger.info("Cleared %d stale proposal(s): %s", len(cleared), ", ".join(cleared))
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(
                    f"Market closed. Cleared {len(cleared)} pending proposal(s): {', '.join(cleared)}",
                    chat_id=ctx.telegram_chat_id,
                )
        else:
            logger.info("Proposal clear at 3:20 PM — nothing pending.")

    await _for_each_user(_run)


async def run_eod():
    """3:35 PM IST — end of day review and journal."""
    logger.info("Running EOD report...")

    async def _run(ctx):
        try:
            result = await asyncio.to_thread(run, "eod")
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(
                    f"EOD Report\n\n{result[:2000]}",
                    chat_id=ctx.telegram_chat_id,
                )
        except Exception as e:
            logger.error("EOD job failed for %s: %s", ctx.uid, e, exc_info=True)
            if _send_telegram and ctx.telegram_chat_id:
                await _send_telegram(f"EOD job failed: {e}", chat_id=ctx.telegram_chat_id)

    await _for_each_user(_run)


def setup_scheduler():
    """Register all cron jobs and return the scheduler."""
    scheduler.add_job(
        run_premarket, "cron",
        day_of_week="mon-fri", hour=8, minute=45,
        id="premarket", replace_existing=True,
    )
    scheduler.add_job(
        run_execution, "cron",
        day_of_week="mon-fri", hour=9, minute=35,
        id="execution", replace_existing=True,
    )
    scheduler.add_job(
        run_heartbeat, "interval",
        minutes=1,
        id="heartbeat", replace_existing=True,
    )
    scheduler.add_job(
        clear_proposals, "cron",
        day_of_week="mon-fri", hour=15, minute=20,
        id="clear_proposals", replace_existing=True,
    )
    scheduler.add_job(
        run_eod, "cron",
        day_of_week="mon-fri", hour=15, minute=35,
        id="eod", replace_existing=True,
    )
    return scheduler
