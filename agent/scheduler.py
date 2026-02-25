import asyncio
import logging
from datetime import datetime

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from agent.runner import run
from agent.tools import pending_approvals, _save_pending

logger = logging.getLogger(__name__)

IST = pytz.timezone("Asia/Kolkata")

# Will be set by main.py so scheduler can send Telegram notifications
_send_telegram = None

scheduler = AsyncIOScheduler(timezone=IST)


def set_telegram_sender(fn):
    """Register the Telegram send function so scheduler can notify."""
    global _send_telegram
    _send_telegram = fn


def _is_market_open() -> bool:
    now = datetime.now(IST)
    # Monday=0, Friday=4
    if now.weekday() > 4:
        return False
    market_open  = now.replace(hour=9,  minute=15, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return market_open <= now <= market_close


async def run_premarket():
    """8:45 AM IST — deep pre-market analysis."""
    logger.info("Running pre-market analysis...")
    # Clear any stale proposals from previous day before generating new ones
    pending_approvals.clear()
    _save_pending()
    try:
        result = await asyncio.get_event_loop().run_in_executor(None, lambda: run("premarket"))
        if _send_telegram:
            await _send_telegram(f"Pre-market complete\n\n{result[:1000]}...")
    except Exception as e:
        logger.error(f"Pre-market job failed: {e}", exc_info=True)
        if _send_telegram:
            await _send_telegram(f"Pre-market job failed: {e}")


async def run_execution():
    """9:35 AM IST — first candle has closed, set real entry levels and propose trades."""
    logger.info("Running execution planning...")
    try:
        result = await asyncio.get_event_loop().run_in_executor(None, lambda: run("execution"))
        if _send_telegram:
            await _send_telegram(f"Execution plan ready\n\n{result[:1000]}")
    except Exception as e:
        logger.error(f"Execution job failed: {e}", exc_info=True)
        if _send_telegram:
            await _send_telegram(f"Execution job failed: {e}")


async def run_heartbeat():
    """Every 5 minutes — position monitoring during market hours. Pure Python, no LLM."""
    if not _is_market_open():
        return  # Silent skip outside trading hours

    logger.debug("Running heartbeat...")
    try:
        from agent.heartbeat import run as heartbeat_run
        result = await asyncio.get_event_loop().run_in_executor(None, heartbeat_run)
        if result.strip() == "HEARTBEAT_OK":
            logger.debug("Heartbeat OK")
            return
        # Non-OK means an action was taken (exit, SL hit, halt) — notify
        logger.info("Heartbeat action: %s", result)
        if _send_telegram:
            await _send_telegram(f"Heartbeat\n\n{result}")
    except Exception as e:
        logger.error(f"Heartbeat failed: {e}", exc_info=True)
        if _send_telegram:
            await _send_telegram(f"Heartbeat error: {e}")


async def clear_proposals():
    """3:20 PM IST — MIS auto-square-off time. All intraday proposals are now stale."""
    cleared = list(pending_approvals.keys())
    pending_approvals.clear()
    _save_pending()
    if cleared:
        logger.info(f"Cleared {len(cleared)} stale MIS proposal(s): {', '.join(cleared)}")
        if _send_telegram:
            await _send_telegram(f"Market closed. Cleared {len(cleared)} pending proposal(s): {', '.join(cleared)}")
    else:
        logger.info("Proposal clear at 3:20 PM — nothing pending.")


async def run_eod():
    """3:35 PM IST — end of day review and journal."""
    logger.info("Running EOD report...")
    try:
        result = await asyncio.get_event_loop().run_in_executor(None, lambda: run("eod"))
        if _send_telegram:
            await _send_telegram(f"EOD Report\n\n{result[:2000]}")
    except Exception as e:
        logger.error(f"EOD job failed: {e}", exc_info=True)
        if _send_telegram:
            await _send_telegram(f"EOD job failed: {e}")


def setup_scheduler():
    """Register all cron jobs and return the scheduler."""
    # Pre-market: 8:45 AM IST Mon-Fri
    scheduler.add_job(
        run_premarket,
        "cron",
        day_of_week="mon-fri",
        hour=8,
        minute=45,
        id="premarket",
        replace_existing=True,
    )

    # Execution planning: 9:35 AM IST Mon-Fri (first candle closed at 9:30)
    scheduler.add_job(
        run_execution,
        "cron",
        day_of_week="mon-fri",
        hour=9,
        minute=35,
        id="execution",
        replace_existing=True,
    )

    # Intraday heartbeat: every 5 minutes
    scheduler.add_job(
        run_heartbeat,
        "interval",
        minutes=5,
        id="heartbeat",
        replace_existing=True,
    )

    # Proposal clear: 3:20 PM IST Mon-Fri (MIS auto-square-off time)
    scheduler.add_job(
        clear_proposals,
        "cron",
        day_of_week="mon-fri",
        hour=15,
        minute=20,
        id="clear_proposals",
        replace_existing=True,
    )

    # EOD report: 3:35 PM IST Mon-Fri
    scheduler.add_job(
        run_eod,
        "cron",
        day_of_week="mon-fri",
        hour=15,
        minute=35,
        id="eod",
        replace_existing=True,
    )

    return scheduler
