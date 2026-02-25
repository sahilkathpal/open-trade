"""
Telegram bot — multi-user, multi-command trading interface.

Each handler resolves the chat_id → uid → UserContext before executing.
In single-user mode (no Firestore), falls back to TELEGRAM_CHAT_ID env var.
"""
import asyncio
import logging
import os
import secrets

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters

load_dotenv()

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN    = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID      = int(os.environ.get("TELEGRAM_CHAT_ID", "0"))
TELEGRAM_BOT_USERNAME = os.environ.get("TELEGRAM_BOT_USERNAME", "")

_app = None


_COMMANDS = [
    ("start",     "Connect your account"),
    ("status",    "Pending trade proposals"),
    ("positions", "Open positions with P&L"),
    ("funds",     "Available balance"),
    ("watchlist", "Stocks being watched today"),
    ("triggers",  "Active monitoring triggers"),
    ("pause",     "Pause the vibe-trade agent"),
    ("resume",    "Resume the vibe-trade agent"),
    ("run",       "Run a mid-session catchup"),
    ("exit",      "Emergency exit a position"),
    ("help",      "Show all commands"),
]


def setup_telegram() -> Application:
    global _app
    _app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    _app.add_handler(CommandHandler("start",     _handle_start))
    _app.add_handler(CommandHandler("status",    _handle_status))
    _app.add_handler(CommandHandler("positions", _handle_positions))
    _app.add_handler(CommandHandler("funds",     _handle_funds))
    _app.add_handler(CommandHandler("watchlist", _handle_watchlist))
    _app.add_handler(CommandHandler("triggers",  _handle_triggers))
    _app.add_handler(CommandHandler("pause",     _handle_pause))
    _app.add_handler(CommandHandler("resume",    _handle_resume))
    _app.add_handler(CommandHandler("run",       _handle_run))
    _app.add_handler(CommandHandler("exit",      _handle_exit))
    _app.add_handler(CommandHandler("help",      _handle_help))
    _app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _handle_message))
    return _app


async def send_message(text: str, chat_id: int = None):
    """Send a message to a Telegram chat. Falls back to TELEGRAM_CHAT_ID if not specified."""
    if not _app:
        logger.warning("Telegram not configured — skipping send")
        return
    target = chat_id or TELEGRAM_CHAT_ID
    if not target:
        return
    try:
        await _app.bot.send_message(chat_id=target, text=text)
    except Exception as e:
        logger.error("Telegram send failed: %s", e)


# ── Context resolution ─────────────────────────────────────────────────────────

def _resolve_ctx(chat_id: int):
    """
    Resolve a Telegram chat_id to a UserContext.
    Returns None if the chat is not linked to any account.
    """
    from agent.user_context import UserContext, _get_default_ctx
    from agent.firestore import is_enabled, get_user_by_chat_id

    if not is_enabled():
        # Single-user mode: only the configured chat_id can use the bot
        if TELEGRAM_CHAT_ID and chat_id != TELEGRAM_CHAT_ID:
            return None
        return _get_default_ctx()

    user_doc = get_user_by_chat_id(chat_id)
    if not user_doc:
        return None
    return UserContext(user_doc["uid"], user_doc)


def _require_ctx(chat_id: int):
    """Returns (ctx, error_text). error_text is None if ctx resolved successfully."""
    ctx = _resolve_ctx(chat_id)
    if ctx is None:
        return None, (
            "Your Telegram is not linked to any account.\n\n"
            "Go to the Settings page on the web app and follow the Telegram connection steps."
        )
    return ctx, None


# ── Command handlers ───────────────────────────────────────────────────────────

async def _handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = context.args or []
    chat_id = update.effective_chat.id

    if args:
        # Deep link: /start <code>
        code = args[0]
        from agent.firestore import is_enabled, get_telegram_pending, delete_telegram_pending, update_user
        if not is_enabled():
            await update.message.reply_text("Deep link connection requires Firebase. Contact support.")
            return
        uid = get_telegram_pending(code)
        if not uid:
            await update.message.reply_text("This link has expired or is invalid. Generate a new one from Settings.")
            return
        delete_telegram_pending(code)
        update_user(uid, {"telegram_chat_id": chat_id})
        await update.message.reply_text(
            "Your Telegram account is now linked!\n\n"
            "You'll receive trade proposals, EOD reports, and alerts here.\n\n"
            "Type /status to get started."
        )
        return

    # Plain /start
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    await update.message.reply_text(
        f"vibe-trade agent online.\n\n"
        f"Commands:\n"
        f"/status — pending proposals\n"
        f"/positions — open positions with P&L\n"
        f"/funds — available balance\n"
        f"/watchlist — stocks being watched today\n"
        f"/triggers — active monitoring triggers\n"
        f"/pause — pause the vibe-trade agent\n"
        f"/resume — resume the vibe-trade agent\n"
        f"/run catchup — run a mid-session catchup\n"
        f"/exit SYMBOL — emergency exit a position\n"
        f"approve SYMBOL / deny SYMBOL — approve or reject proposals"
    )


async def _handle_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    lines = ["*Vibe Trade — Commands*\n"]
    for cmd, desc in _COMMANDS:
        lines.append(f"/{cmd} — {desc}")
    lines.append("\nTo approve/deny a trade proposal, reply:\n`approve SYMBOL` or `deny SYMBOL`")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _handle_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        from agent.tools import get_pending_approvals
        pending = get_pending_approvals()
        if not pending:
            await update.message.reply_text("No pending proposals.")
        else:
            lines = ["Pending proposals:"]
            for sym, p in pending.items():
                lines.append(
                    f"- {sym}: entry=₹{p['entry_price']}, qty={p['quantity']}, sl=₹{p['stop_loss_price']}"
                )
            await update.message.reply_text("\n".join(lines))
    finally:
        reset_user_ctx(token)


async def _handle_positions(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        def _get():
            from agent.heartbeat import load_tracked_positions, _ltp_from_quote
            from agent.tools import get_positions, get_market_quote
            tracked = load_tracked_positions()
            if not tracked:
                return "No tracked positions."
            live = get_positions()
            if live and len(live) == 1 and isinstance(live[0], dict) and live[0].get("token_expired"):
                return "Your Dhan access token has expired. Update it in Settings to resume trading."
            live_syms = set()
            if live and not (len(live) == 1 and isinstance(live[0], dict) and live[0].get("error")):
                for p in live:
                    sym = p.get("tradingSymbol") or p.get("symbol", "")
                    qty = p.get("netQty") or p.get("quantity", 0)
                    if sym and int(qty) != 0:
                        live_syms.add(sym)
            lines = []
            for sym, pos in tracked.items():
                if sym not in live_syms:
                    continue
                ltp = _ltp_from_quote(get_market_quote([sym])) or pos["entry_price"]
                pnl = round((ltp - pos["entry_price"]) * pos["quantity"], 2)
                sign = "+" if pnl >= 0 else ""
                lines.append(
                    f"{sym}: entry ₹{pos['entry_price']:.2f} | LTP ₹{ltp:.2f} | "
                    f"P&L {sign}₹{pnl:.2f} | SL ₹{pos['stop_loss_price']:.2f}"
                )
            return "\n".join(lines) if lines else "No open positions."

        result = await asyncio.to_thread(_get)
        await update.message.reply_text(result)
    finally:
        reset_user_ctx(token)


async def _handle_funds(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        def _get():
            from agent.tools import get_funds
            f = get_funds()
            if f.get("token_expired"):
                return "Your Dhan access token has expired. Update it in Settings to resume trading."
            if f.get("error"):
                return f"Error: {f['error']}"
            return (
                f"Balance: ₹{f.get('available_balance', 0):.2f}\n"
                f"Margin used: ₹{f.get('used_margin', 0):.2f}\n"
                f"Day P&L: ₹{f.get('day_pnl', 0):.2f}"
            )
        result = await asyncio.to_thread(_get)
        await update.message.reply_text(result)
    finally:
        reset_user_ctx(token)


async def _handle_watchlist(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        from agent.tools import load_watchlist
        wl = load_watchlist()
        if not wl:
            await update.message.reply_text("Watchlist is empty.")
        else:
            lines = [f"Watchlist ({len(wl)} stocks):"]
            for sym, e in wl.items():
                lines.append(f"- {sym}: ₹{e['entry_min']}–₹{e['entry_max']} | SL ₹{e['stop_loss_price']} | Target ₹{e['target_price']}")
            await update.message.reply_text("\n".join(lines))
    finally:
        reset_user_ctx(token)


async def _handle_triggers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        from agent.tools import load_triggers
        trigs = load_triggers()
        if not trigs:
            await update.message.reply_text("No active triggers.")
        else:
            lines = [f"Triggers ({len(trigs)}):"]
            for t in trigs:
                lines.append(f"- [{t['id']}] {t['type']}: {t.get('reason', '')[:60]}")
            await update.message.reply_text("\n".join(lines))
    finally:
        reset_user_ctx(token)


async def _handle_pause(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.firestore import is_enabled, update_user
    if is_enabled():
        update_user(ctx.uid, {"paused": True})
    await update.message.reply_text(
        "vibe-trade agent paused. No new positions will be opened.\n"
        "Use /resume to re-enable."
    )


async def _handle_resume(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.firestore import is_enabled, update_user
    if is_enabled():
        update_user(ctx.uid, {"paused": False})
    await update.message.reply_text("vibe-trade agent resumed.")


async def _handle_run(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    args = context.args or []
    job_type = args[0].lower() if args else ""
    if job_type != "catchup":
        await update.message.reply_text("Usage: /run catchup")
        return

    await update.message.reply_text(f"Running {job_type}...")

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        from agent.runner import run as agent_run
        result = await asyncio.to_thread(agent_run, job_type)
        await update.message.reply_text(f"{job_type} complete\n\n{result[:2000]}")
    except Exception as e:
        await update.message.reply_text(f"{job_type} failed: {e}")
    finally:
        reset_user_ctx(token)


async def _handle_exit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Emergency exit: /exit SYMBOL"""
    chat_id = update.effective_chat.id
    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    args = context.args or []
    if not args:
        await update.message.reply_text("Usage: /exit SYMBOL")
        return

    symbol = args[0].upper()

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        def _do_exit():
            from agent.heartbeat import load_tracked_positions
            tracked = load_tracked_positions()
            if symbol not in tracked:
                return f"No tracked position for {symbol}."
            pos = tracked[symbol]
            from agent.tools import exit_position
            result = exit_position(symbol, pos["security_id"], pos["quantity"], "Manual Telegram exit")
            return f"Exit order placed for {symbol}: {result.get('status', result)}"

        result = await asyncio.to_thread(_do_exit)
        await update.message.reply_text(result)
    finally:
        reset_user_ctx(token)


async def _handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle free-form approve/deny messages."""
    chat_id = update.effective_chat.id
    text = update.message.text.strip().lower()

    ctx, err = _require_ctx(chat_id)
    if err:
        await update.message.reply_text(err)
        return

    from agent.user_context import set_user_ctx, reset_user_ctx
    token = set_user_ctx(ctx)
    try:
        # ── approve SYMBOL ──
        if text.startswith("approve "):
            symbol = text.split()[1].upper()

            def _approve():
                from agent.tools import get_pending_approvals, save_pending_approvals, place_trade
                pending = get_pending_approvals()
                if symbol not in pending:
                    return None, f"No pending approval for {symbol}."
                params = pending.pop(symbol)
                save_pending_approvals(pending)
                result = place_trade(**params, approved=True)
                return result, None

            result, err2 = await asyncio.to_thread(_approve)
            if err2:
                await update.message.reply_text(err2)
            else:
                await update.message.reply_text(f"Order submitted for {symbol}: {result}")
            return

        # ── deny SYMBOL ──
        if text.startswith("deny "):
            symbol = text.split()[1].upper()
            from agent.tools import get_pending_approvals, save_pending_approvals
            pending = get_pending_approvals()
            if pending.pop(symbol, None) is not None:
                save_pending_approvals(pending)
                await update.message.reply_text(f"Proposal for {symbol} discarded.")
            else:
                await update.message.reply_text(f"No pending approval for {symbol}.")
            return

        await update.message.reply_text(
            "Commands: /status, /positions, /funds, /watchlist, /triggers, /pause, /resume\n"
            "/run catchup, /exit SYMBOL\n"
            "approve SYMBOL, deny SYMBOL"
        )
    finally:
        reset_user_ctx(token)
