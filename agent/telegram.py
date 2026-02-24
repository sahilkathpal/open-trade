import asyncio
import logging
import os

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters

load_dotenv()

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = int(os.environ.get("TELEGRAM_CHAT_ID", "0"))

# Shared reference to pending_approvals from tools.py (set in main.py)
_pending_approvals = None
_place_trade_fn = None

_app = None


def setup_telegram(pending_approvals: dict, place_trade_fn) -> Application:
    global _pending_approvals, _place_trade_fn, _app
    _pending_approvals = pending_approvals
    _place_trade_fn    = place_trade_fn
    _app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    _app.add_handler(CommandHandler("start", _handle_start))
    _app.add_handler(CommandHandler("status", _handle_status))
    _app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _handle_message))
    return _app


async def send_message(text: str):
    """Send a message to the configured Telegram chat."""
    if not _app or not TELEGRAM_CHAT_ID:
        logger.warning("Telegram not configured — skipping send")
        return
    await _app.bot.send_message(
        chat_id=TELEGRAM_CHAT_ID,
        text=text,
        parse_mode="Markdown",
    )


# ── Command handlers ───────────────────────────────────────────────────────────

async def _handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Trading agent online.\n\n"
        "Commands:\n"
        "- approve SYMBOL: approve a pending trade\n"
        "- deny SYMBOL: reject a pending trade\n"
        "- /status: show pending approvals\n"
        "- premarket: trigger pre-market run\n"
        "- heartbeat: trigger heartbeat\n"
        "- eod: trigger EOD report"
    )


async def _handle_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _pending_approvals:
        await update.message.reply_text("No pending approvals.")
        return
    lines = ["Pending approvals:"]
    for sym, params in _pending_approvals.items():
        lines.append(
            f"- {sym}: entry={params['entry_price']}, qty={params['quantity']}, sl={params['stop_loss_price']}"
        )
    await update.message.reply_text("\n".join(lines))


async def _handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip().lower()

    # ── approve SYMBOL ──
    if text.startswith("approve "):
        symbol = text.split()[1].upper()
        if symbol not in _pending_approvals:
            await update.message.reply_text(f"No pending approval for {symbol}.")
            return
        params = _pending_approvals.pop(symbol)
        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: _place_trade_fn(**params, approved=True)
            )
            await update.message.reply_text(f"Order submitted for {symbol}: {result}")
        except Exception as e:
            await update.message.reply_text(f"Error placing order: {e}")
        return

    # ── deny SYMBOL ──
    if text.startswith("deny "):
        symbol = text.split()[1].upper()
        if _pending_approvals.pop(symbol, None) is not None:
            await update.message.reply_text(f"Proposal for {symbol} discarded.")
        else:
            await update.message.reply_text(f"No pending approval for {symbol}.")
        return

    # ── manual trigger commands ──
    if text in ("premarket", "pre-market", "pre market"):
        await update.message.reply_text("Running pre-market analysis...")
        from agent.scheduler import run_premarket
        asyncio.create_task(run_premarket())
        return

    if text == "heartbeat":
        await update.message.reply_text("Running heartbeat...")
        from agent.scheduler import run_heartbeat
        asyncio.create_task(run_heartbeat())
        return

    if text in ("eod", "end of day"):
        await update.message.reply_text("Running EOD report...")
        from agent.scheduler import run_eod
        asyncio.create_task(run_eod())
        return

    await update.message.reply_text(
        "Commands: approve SYMBOL, deny SYMBOL, premarket, heartbeat, eod"
    )
