import json
import logging
from datetime import datetime
from pathlib import Path

import pytz as _pytz

_IST = _pytz.timezone("Asia/Kolkata")

from data.indicators import compute_indicators
from data.fundamentals import get_fundamentals as _get_fundamentals
from data.news import fetch_news as _fetch_news
from agent.user_context import get_user_ctx

logger = logging.getLogger(__name__)

_SHARED_READONLY = {"SOUL.md", "HEARTBEAT.md"}


def _append_activity(entry: str):
    """Append a timestamped line to the user's ACTIVITY.md."""
    try:
        ts = datetime.now(_IST).strftime("%Y-%m-%d %H:%M:%S IST")
        path = get_user_ctx().memory_dir / "ACTIVITY.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(f"- [{ts}] {entry}\n")
    except Exception as e:
        logger.debug("Failed to append activity: %s", e)


# ── per-user path helpers ──────────────────────────────────────────────────────

def _pending_path() -> Path:
    return get_user_ctx().memory_dir / "PENDING.json"

def _positions_path() -> Path:
    return get_user_ctx().memory_dir / "OPEN_POSITIONS.json"


def _triggers_path() -> Path:
    return get_user_ctx().memory_dir / "TRIGGERS.json"

def _memory_dir() -> Path:
    return get_user_ctx().memory_dir


# ── pending approvals (file-backed, per-user) ──────────────────────────────────

def get_pending_approvals() -> dict:
    path = _pending_path()
    if path.exists():
        try:
            data = json.loads(path.read_text())
            now = datetime.now(_IST)
            active = {}
            for symbol, proposal in data.items():
                exp_str = proposal.get("expires_at", "")
                if exp_str:
                    try:
                        exp = datetime.fromisoformat(exp_str)
                        if exp.tzinfo is None:
                            exp = _IST.localize(exp)
                        if now > exp:
                            logger.debug("Proposal %s expired — discarding", symbol)
                            continue
                    except Exception:
                        pass
                active[symbol] = proposal
            return active
        except Exception:
            pass
    return {}


def save_pending_approvals(data: dict):
    path = _pending_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


# ── open positions helpers ─────────────────────────────────────────────────────

def _load_open_positions() -> dict:
    path = _positions_path()
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {}


def _save_open_positions(data: dict):
    path = _positions_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))



# ── trigger helpers ────────────────────────────────────────────────────────────

def load_triggers() -> list:
    path = _triggers_path()
    if path.exists():
        try:
            data = json.loads(path.read_text())
            return data if isinstance(data, list) else []
        except Exception:
            pass
    return []


def _save_triggers(triggers: list):
    path = _triggers_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(triggers, indent=2, default=str))


# ── agent P&L tracking (file-backed, per-user) ────────────────────────────────

def _agent_pnl_path() -> Path:
    return get_user_ctx().memory_dir / "AGENT_PNL.json"


def _load_agent_pnl() -> dict:
    path = _agent_pnl_path()
    today = datetime.now(_IST).strftime("%Y-%m-%d")
    if path.exists():
        try:
            data = json.loads(path.read_text())
            if data.get("date") == today:
                return data
        except Exception:
            pass
    return {"date": today, "tracked_symbols": [], "realized": 0.0}


def _save_agent_pnl(data: dict):
    path = _agent_pnl_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str))


def get_agent_pnl() -> dict:
    """Return today's agent P&L (realized only; unrealized computed in state API)."""
    return _load_agent_pnl()


def reset_agent_pnl():
    """Reset agent P&L for a new trading session (premarket or catchup)."""
    today = datetime.now(_IST).strftime("%Y-%m-%d")
    _save_agent_pnl({"date": today, "tracked_symbols": [], "realized": 0.0})


def _extract_ltp(quote: dict) -> float | None:
    """Extract LTP from a get_market_quote() response.

    Real Dhan API (via dhanhq SDK) structure:
        {"data": {"data": {"NSE_EQ": {"<secid>": {"last_price": N}}}, "status": "success"}}
    Sandbox mock is flat:
        {"data": {"SYMBOL": {"ltp": N}}}
    Recurse up to 3 levels into "data" to handle both.
    """
    if not isinstance(quote, dict):
        return None
    data = quote.get("data", {})
    for outer_val in data.values():
        if not isinstance(outer_val, dict):
            continue
        ltp = outer_val.get("ltp") or outer_val.get("last_price")
        if ltp is not None:
            return float(ltp)
        for inner_val in outer_val.values():
            if not isinstance(inner_val, dict):
                continue
            ltp = inner_val.get("ltp") or inner_val.get("last_price")
            if ltp is not None:
                return float(ltp)
            for deepest_val in inner_val.values():
                if isinstance(deepest_val, dict):
                    ltp = deepest_val.get("ltp") or deepest_val.get("last_price")
                    if ltp is not None:
                        return float(ltp)
    return None


# ── helper ─────────────────────────────────────────────────────────────────────
def _fmt_proposal(symbol, qty, entry, sl, target_est, thesis):
    rr = (target_est - entry) / (entry - sl) if entry != sl else 0
    return (
        f"\U0001f4ca *TRADE PROPOSAL*\n"
        f"Symbol: `{symbol}`\n"
        f"Direction: BUY\n"
        f"Entry: \u20b9{entry:.2f} | SL: \u20b9{sl:.2f} | Target: \u20b9{target_est:.2f}\n"
        f"Qty: {qty} | R:R = {rr:.1f}:1\n\n"
        f"Thesis: {thesis}\n\n"
        f"Reply `approve {symbol}` or `deny {symbol}`"
    )


# ── tool implementations ───────────────────────────────────────────────────────

def get_market_quote(symbols: list[str]) -> dict:
    try:
        return get_user_ctx().dhan.get_quote(symbols)
    except Exception as e:
        return {"error": str(e)}


def get_historical_data(symbol: str, interval: str = "15", days: int = 30) -> dict:
    try:
        from datetime import timedelta
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        dhan = get_user_ctx().dhan
        security_id = dhan.symbol_to_security_id(symbol)
        df = dhan.get_history(security_id, interval=interval, from_date=from_date, to_date=to_date)
        if df.empty:
            return {"symbol": symbol, "data": [], "error": "No data returned"}
        rows = compute_indicators(df)
        if not rows:
            return {"symbol": symbol, "error": "Indicator computation returned no rows"}

        last = rows[-1]
        closes = [r["close"] for r in rows if r.get("close") is not None]
        volumes = [r["volume"] for r in rows if r.get("volume") is not None]
        indicator_keys = [
            "RSI_14", "MACD_12_26_9", "MACDs_12_26_9", "MACDh_12_26_9",
            "SMA_20", "EMA_12", "EMA_26", "VWAP_D",
            "BBL_20_2.0", "BBM_20_2.0", "BBU_20_2.0", "ATRr_14",
        ]
        latest_indicators = {k: round(last[k], 2) for k in indicator_keys if last.get(k) is not None}
        recent_candles = [
            {k: r[k] for k in ("timestamp", "open", "high", "low", "close", "volume") if k in r}
            for r in rows[-5:]
        ]
        return {
            "symbol":   symbol,
            "interval": interval,
            "total_candles": len(rows),
            "period_high":   max(r["high"] for r in rows if r.get("high")),
            "period_low":    min(r["low"]  for r in rows if r.get("low")),
            "avg_volume":    round(sum(volumes) / len(volumes)) if volumes else None,
            "latest_close":  closes[-1] if closes else None,
            "indicators":    latest_indicators,
            "recent_candles": recent_candles,
        }
    except Exception as e:
        return {"error": str(e)}


def get_fundamentals(symbol: str) -> dict:
    try:
        return _get_fundamentals(symbol)
    except Exception as e:
        return {"error": str(e)}


def fetch_news(category: str = "markets", limit: int = 15) -> list[dict]:
    try:
        return _fetch_news(category=category, limit=limit)
    except Exception as e:
        return [{"error": str(e)}]


def get_positions() -> list:
    try:
        return get_user_ctx().dhan.get_positions()
    except Exception as e:
        return [{"error": str(e)}]


def get_funds() -> dict:
    ctx = get_user_ctx()
    try:
        return ctx.dhan.get_funds()
    except Exception as e:
        logger.error("get_funds failed for uid=%s: %s", ctx.uid, e)
        return {"error": str(e)}


def place_trade(
    symbol: str,
    security_id: str,
    transaction_type: str,
    quantity: int,
    entry_price: float,
    stop_loss_price: float,
    thesis: str,
    target_price: float = 0.0,
    approved: bool = False,
    expires_at: str = "",
) -> dict:
    ctx = get_user_ctx()

    # 0. Reject stale approvals
    if approved and expires_at:
        try:
            exp = datetime.fromisoformat(expires_at)
            if exp.tzinfo is None:
                exp = _IST.localize(exp)
            if datetime.now(_IST) > exp:
                return {"status": "rejected", "reason": f"Proposal expired at {expires_at}"}
        except Exception:
            pass

    # 1. Always run risk validation first
    funds = ctx.dhan.get_funds()
    positions = ctx.dhan.get_positions()
    ok, reason = ctx.risk.validate(
        entry_price=entry_price,
        quantity=quantity,
        stop_loss_price=stop_loss_price,
        open_position_count=len(positions),
        available_funds=funds.get("available_balance", 0),
    )
    if not ok:
        return {"status": "rejected", "reason": reason}

    # 2. Check approval requirement
    if not approved and not ctx.autonomous:
        proposal = _fmt_proposal(symbol, quantity, entry_price, stop_loss_price,
                                  target_price or entry_price * 1.04, thesis)
        # Expiry: Claude-provided value, or default to 15:00 IST same day
        today = datetime.now(_IST)
        default_expiry = today.replace(hour=15, minute=0, second=0, microsecond=0).isoformat()
        expiry = expires_at if expires_at else default_expiry
        pending = get_pending_approvals()
        pending[symbol] = {
            "symbol": symbol,
            "security_id": security_id,
            "transaction_type": transaction_type,
            "quantity": quantity,
            "entry_price": entry_price,
            "stop_loss_price": stop_loss_price,
            "thesis": thesis,
            "target_price": target_price,
            "expires_at": expiry,
        }
        save_pending_approvals(pending)
        _append_activity(
            f"TRADE QUEUED {transaction_type} {symbol} qty={quantity} "
            f"entry=₹{entry_price:.2f} sl=₹{stop_loss_price:.2f} (pending approval)"
        )
        try:
            from agent.telegram import notify_proposal_sync
            rr = round((target_price - entry_price) / (entry_price - stop_loss_price), 1) if entry_price != stop_loss_price else 0
            msg = (
                f"New proposal: {transaction_type} {symbol}\n\n"
                f"Entry  ₹{entry_price:.2f} | Qty {quantity}\n"
                f"SL     ₹{stop_loss_price:.2f}\n"
                f"Target ₹{target_price:.2f} | R:R {rr}:1\n\n"
                f"{thesis[:300]}\n\n"
                f"Reply: approve {symbol}  or  deny {symbol}"
            )
            notify_proposal_sync(msg, chat_id=ctx.telegram_chat_id)
        except Exception:
            pass
        return {
            "status": "pending_approval",
            "proposal": proposal,
        }

    # 3. Emit to activity feed
    try:
        from api import activity_log
        rr = round((target_price - entry_price) / (entry_price - stop_loss_price), 1) if entry_price != stop_loss_price else 0
        activity_log.emit({
            "type": "trade",
            "symbol": symbol,
            "summary": f"AUTO {transaction_type} {symbol} @ ₹{entry_price} | SL ₹{stop_loss_price} | Target ₹{target_price} | R:R {rr}:1",
        })
    except Exception:
        pass

    # 4. Place entry order (market)
    entry_resp = ctx.dhan.place_order(
        security_id=security_id,
        txn_type="BUY",
        qty=quantity,
        order_type="MARKET",
        product_type="INTRA",
        price=0,
    )

    # 5. Place stop-loss order
    sl_resp = ctx.dhan.place_order(
        security_id=security_id,
        txn_type="SELL",
        qty=quantity,
        order_type="STOPLIMIT",
        product_type="INTRA",
        price=stop_loss_price,
        trigger_price=round(stop_loss_price * 1.001, 2),
    )

    # Track locally so the heartbeat knows SL/target/entry
    sl_order_id = None
    if isinstance(sl_resp, dict):
        sl_order_id = sl_resp.get("orderId") or sl_resp.get("data", {}).get("orderId")

    open_positions = _load_open_positions()
    open_positions[symbol] = {
        "security_id":     security_id,
        "entry_price":     entry_price,
        "stop_loss_price": stop_loss_price,
        "target_price":    target_price,
        "quantity":        quantity,
        "sl_order_id":     sl_order_id,
    }
    _save_open_positions(open_positions)

    # Record this symbol as agent-tracked for P&L attribution
    try:
        pnl_data = _load_agent_pnl()
        if symbol not in pnl_data["tracked_symbols"]:
            pnl_data["tracked_symbols"].append(symbol)
            _save_agent_pnl(pnl_data)
    except Exception as e:
        logger.warning("Failed to record tracked symbol %s: %s", symbol, e)

    _append_activity(
        f"TRADE PLACED {transaction_type} {symbol} qty={quantity} "
        f"entry=₹{entry_price:.2f} sl=₹{stop_loss_price:.2f} target=₹{target_price:.2f}"
    )

    return {
        "status":      "placed",
        "symbol":      symbol,
        "entry_order": entry_resp,
        "sl_order":    sl_resp,
    }


def exit_position(symbol: str, security_id: str, quantity: int, reason: str) -> dict:
    try:
        ctx = get_user_ctx()
        open_positions = _load_open_positions()
        pos_data = open_positions.get(symbol, {})

        resp = ctx.dhan.place_order(
            security_id=security_id,
            txn_type="SELL",
            qty=quantity,
            order_type="MARKET",
            product_type="INTRA",
            price=0,
        )

        sl_order_id = pos_data.get("sl_order_id")
        if sl_order_id:
            try:
                ctx.dhan.cancel_order(sl_order_id)
            except Exception:
                pass

        open_positions.pop(symbol, None)
        _save_open_positions(open_positions)
        _append_activity(f"EXIT {symbol} qty={quantity} reason={reason}")
        try:
            from api import activity_log
            activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"EXIT {symbol}: {reason}"})
        except Exception:
            pass
        return {"status": "exit_placed", "symbol": symbol, "reason": reason, "order": resp}
    except Exception as e:
        return {"error": str(e)}



def get_index_quote(index: str = "NIFTY50") -> dict:
    """Get LTP for a NSE index (NIFTY50, BANKNIFTY, FINNIFTY)."""
    try:
        return get_user_ctx().dhan.get_index_quote(index)
    except Exception as e:
        return {"error": str(e)}


def write_trigger(
    id: str,
    type: str,
    reason: str,
    expires_at: str,
    mode: str = "soft",
    action: str = "place_trade",
    symbol: str = None,
    threshold: float = None,
    at: str = None,
    buffer_pct: float = None,
    above_pct: float = None,
    # hard-trigger fields (mode="hard", type="price_in_range")
    security_id: str = None,
    transaction_type: str = None,
    entry_min: float = None,
    entry_max: float = None,
    stop_loss_price: float = None,
    target_price: float = None,
    quantity: int = None,
    thesis: str = None,
    rsi_max: float = None,
    candle_close_above: float = None,
) -> dict:
    """
    Set a monitoring trigger. The heartbeat evaluates all triggers every 5 minutes.

    mode="soft" (default): invokes the Claude agent when the condition fires.
    mode="hard": executes an action directly (no LLM).
      action="place_trade" (default): executes place_trade() — requires type="price_in_range"
        plus all trade fields.
      action="exit_all": exits all open positions — use for EOD hard exits. Works with
        any trigger type (typically type="time").
    """
    SYMBOL_REQUIRED_TYPES = {
        "price_above", "price_below",
        "price_in_range",
        "index_above", "index_below",
        "near_stop", "near_target",
        "position_pnl_pct",
    }
    if type in SYMBOL_REQUIRED_TYPES and not symbol:
        return {"error": f"'symbol' is required for trigger type '{type}'"}

    if action not in ("place_trade", "exit_all"):
        return {"error": f"Invalid action '{action}'. Must be 'place_trade' or 'exit_all'"}

    if mode == "hard":
        if action == "place_trade":
            if type != "price_in_range":
                return {"error": "Hard place_trade triggers must use type='price_in_range'"}
            missing = [f for f in ["security_id", "transaction_type", "entry_min", "entry_max",
                                    "stop_loss_price", "target_price", "quantity", "thesis"]
                       if locals()[f] is None]
            if missing:
                return {"error": f"Hard trigger missing required fields: {', '.join(missing)}"}

    if type == "time" and not at:
        return {"error": "'at' is required for type='time' (format: HH:MM IST, 24-hour)"}

    if type == "time" and at:
        try:
            import pytz
            from datetime import datetime as _dt
            _IST = pytz.timezone("Asia/Kolkata")
            _now = _dt.now(_IST)
            h, m = map(int, at.split(":"))
            trigger_dt = _now.replace(hour=h, minute=m, second=0, microsecond=0)
            if _now >= trigger_dt:
                return {"error": f"Time trigger '{at}' is already in the past (now {_now.strftime('%H:%M')} IST). Set a future time or use a different trigger type."}
        except ValueError:
            return {"error": f"Invalid time format '{at}'. Use HH:MM (24-hour IST)."}

    triggers = load_triggers()
    triggers = [t for t in triggers if t.get("id") != id]
    trigger = {"id": id, "type": type, "mode": mode, "action": action, "reason": reason, "expires_at": expires_at}
    if symbol is not None:           trigger["symbol"]              = symbol
    if threshold is not None:        trigger["threshold"]            = threshold
    if at is not None:               trigger["at"]                   = at
    if buffer_pct is not None:       trigger["buffer_pct"]           = buffer_pct
    if above_pct is not None:        trigger["above_pct"]            = above_pct
    if security_id is not None:      trigger["security_id"]          = security_id
    if transaction_type is not None: trigger["transaction_type"]     = transaction_type
    if entry_min is not None:        trigger["entry_min"]            = entry_min
    if entry_max is not None:        trigger["entry_max"]            = entry_max
    if stop_loss_price is not None:  trigger["stop_loss_price"]      = stop_loss_price
    if target_price is not None:     trigger["target_price"]         = target_price
    if quantity is not None:         trigger["quantity"]             = quantity
    if thesis is not None:           trigger["thesis"]               = thesis
    if rsi_max is not None:          trigger["rsi_max"]              = rsi_max
    if candle_close_above is not None: trigger["candle_close_above"] = candle_close_above
    triggers.append(trigger)
    _save_triggers(triggers)
    parts = [f"TRIGGER SET id={id} type={type} mode={mode}"]
    if symbol:
        parts.append(f"symbol={symbol}")
    parts.append(f"reason={reason}")
    _append_activity(" ".join(parts))
    return {"status": "ok", "trigger_id": id, "type": type, "mode": mode}


def remove_trigger(id: str) -> dict:
    """Remove a trigger by id."""
    triggers = load_triggers()
    before = len(triggers)
    triggers = [t for t in triggers if t.get("id") != id]
    _save_triggers(triggers)
    removed = len(triggers) < before
    return {"status": "removed" if removed else "not_found", "trigger_id": id}


def list_triggers() -> list:
    """Return all active (non-expired) triggers."""
    now = datetime.now(_IST)
    active = []
    for t in load_triggers():
        exp_str = t.get("expires_at", "")
        if exp_str:
            try:
                exp = datetime.fromisoformat(exp_str)
                if exp.tzinfo is None:
                    exp = _IST.localize(exp)
                if now > exp:
                    continue
            except Exception:
                pass
        active.append(t)
    return active


def write_schedule(
    id: str,
    cron: str,
    job_type: str,
    reason: str,
    prompt: str = "",
) -> dict:
    """
    Create or update a recurring scheduled job. Stored in memory/{uid}/SCHEDULE.json
    and registered in APScheduler immediately.
    """
    from agent.schedule_manager import get_schedule_manager, _load_schedule, _save_schedule
    ctx = get_user_ctx()
    uid = ctx.uid

    # Validate cron (5 fields)
    if len(cron.strip().split()) != 5:
        return {"error": f"Invalid cron expression '{cron}'. Must be 5 fields: minute hour dom month dow"}

    if job_type != "custom":
        return {"error": "job_type must be 'custom'. All scheduled jobs use Claude-authored prompts."}

    if not prompt:
        return {"error": "prompt is required. Write the full instruction for what Claude should do when this job fires."}

    entry = {
        "id": id,
        "cron": cron,
        "job_type": job_type,
        "reason": reason,
        "prompt": prompt,
        "created_at": datetime.now(_IST).isoformat(),
    }

    entries = _load_schedule(uid)
    entries = [e for e in entries if e.get("id") != id]
    entries.append(entry)
    _save_schedule(uid, entries)

    mgr = get_schedule_manager()
    if mgr:
        mgr.add_job(uid, entry)

    return {"status": "ok", "schedule_id": id, "cron": cron, "job_type": job_type}


def remove_schedule(id: str) -> dict:
    """Remove a scheduled job by id."""
    from agent.schedule_manager import get_schedule_manager, _load_schedule, _save_schedule
    ctx = get_user_ctx()
    uid = ctx.uid

    entries = _load_schedule(uid)
    before = len(entries)
    entries = [e for e in entries if e.get("id") != id]
    _save_schedule(uid, entries)

    mgr = get_schedule_manager()
    if mgr:
        mgr.remove_job(uid, id)

    removed = len(entries) < before
    return {"status": "removed" if removed else "not_found", "schedule_id": id}


def list_schedules() -> list:
    """Return all schedule entries for the current user."""
    from agent.schedule_manager import _load_schedule
    ctx = get_user_ctx()
    return _load_schedule(ctx.uid)


def read_memory(filename: str) -> str:
    if not filename.endswith(".md"):
        return "Error: only .md files are readable"
    if filename in _SHARED_READONLY:
        path = Path("memory") / filename
    else:
        path = _memory_dir() / filename
    if not path.exists():
        return f"File {filename} does not exist yet."
    return path.read_text()


def write_memory(filename: str, content: str) -> dict:
    if not filename.endswith(".md"):
        return {"error": "Only .md files are allowed"}
    if filename in _SHARED_READONLY:
        return {"error": f"{filename} is a shared read-only file"}
    path = _memory_dir() / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return {"status": "ok", "filename": filename, "bytes_written": len(content)}


def append_journal(entry: str) -> dict:
    path = _memory_dir() / "JOURNAL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(f"\n\n---\n\n{entry}")
    return {"status": "ok", "appended_bytes": len(entry)}


# ── tool executor ─────────────────────────────────────────────────────────────
TOOL_FUNCTIONS = {
    "get_market_quote":      get_market_quote,
    "get_historical_data":   get_historical_data,
    "get_fundamentals":      get_fundamentals,
    "fetch_news":            fetch_news,
    "get_positions":         get_positions,
    "get_funds":             get_funds,
    "get_index_quote":       get_index_quote,
    "place_trade":           place_trade,
    "exit_position":         exit_position,
    "write_trigger":         write_trigger,
    "remove_trigger":        remove_trigger,
    "list_triggers":         list_triggers,
    "write_schedule":        write_schedule,
    "remove_schedule":       remove_schedule,
    "list_schedules":        list_schedules,
    "read_memory":           read_memory,
    "write_memory":          write_memory,
    "append_journal":        append_journal,
}


def execute_tool(name: str, inputs: dict):
    fn = TOOL_FUNCTIONS.get(name)
    if fn is None:
        return {"error": f"Unknown tool: {name}"}
    return fn(**inputs)


# ── Anthropic tool schemas ────────────────────────────────────────────────────
ALL_TOOL_SCHEMAS = [
    {
        "name": "get_market_quote",
        "description": "Get live LTP, OHLC, and volume for a list of NSE EQ symbols from Dhan.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of NSE ticker symbols (e.g. ['RELIANCE', 'TCS'])",
                }
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "get_historical_data",
        "description": (
            "Fetch OHLCV historical data with computed technical indicators "
            "(SMA20, EMA12, EMA26, RSI14, MACD, Bollinger Bands, ATR14, VWAP) for an NSE symbol."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol":   {"type": "string", "description": "NSE ticker symbol"},
                "interval": {
                    "type": "string",
                    "enum": ["1", "5", "15", "25", "60", "D"],
                    "description": "Candle interval: 1/5/15/25/60 minutes or D for daily",
                    "default": "15",
                },
                "days": {
                    "type": "integer",
                    "description": "Number of calendar days of history to fetch",
                    "default": 30,
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_fundamentals",
        "description": "Fetch fundamental data (P/E, margins, ROE, revenue growth, debt/equity) for an NSE symbol via yfinance.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "NSE ticker symbol without .NS suffix"}
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "fetch_news",
        "description": "Fetch latest financial news headlines from Business Standard RSS feeds.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["markets", "economy", "companies", "finance"],
                    "description": "News category",
                    "default": "markets",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of articles",
                    "default": 15,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_positions",
        "description": "Get current open positions from Dhan.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_funds",
        "description": "Get available balance, used margin, and day P&L from Dhan.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "place_trade",
        "description": (
            "Place a risk-validated trade on Dhan. Runs RiskGuard checks first. "
            "If autonomous=false and not yet approved, returns a pending_approval proposal "
            "that must be sent to the user via Telegram."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol":           {"type": "string"},
                "security_id":      {"type": "string"},
                "transaction_type": {"type": "string", "enum": ["BUY", "SELL"]},
                "quantity":         {"type": "integer"},
                "entry_price":      {"type": "number"},
                "stop_loss_price":  {"type": "number"},
                "thesis":           {"type": "string", "description": "1-2 sentence trade thesis"},
                "target_price":     {"type": "number", "description": "Estimated target price for R:R calculation"},
                "approved":         {"type": "boolean", "default": False},
                "expires_at":       {"type": "string", "description": "ISO 8601 datetime when this proposal expires. Defaults to 15:00 IST today for intraday MIS trades. Set later for CNC/delivery trades or when the entry window extends beyond 3 PM."},
            },
            "required": ["symbol", "security_id", "transaction_type", "quantity",
                         "entry_price", "stop_loss_price", "thesis"],
        },
    },
    {
        "name": "exit_position",
        "description": "Exit an open position with a market sell order. Logs the reason.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol":      {"type": "string"},
                "security_id": {"type": "string"},
                "quantity":    {"type": "integer"},
                "reason":      {"type": "string"},
            },
            "required": ["symbol", "security_id", "quantity", "reason"],
        },
    },
    {
        "name": "read_memory",
        "description": (
            "Read a per-user memory file. Any .md filename is allowed. "
            "SOUL.md and HEARTBEAT.md are shared system files (read-only, served from project root). "
            "All other .md files are read from the per-user memory directory. "
            "Universal files: STRATEGY.md, JOURNAL.md, LEARNINGS.md. "
            "Strategy-specific files (e.g. HOLDINGS.md, MARKET.md, THESIS.md) are created by Claude as needed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Any .md filename (e.g. STRATEGY.md, JOURNAL.md, HOLDINGS.md). Must end in .md.",
                }
            },
            "required": ["filename"],
        },
    },
    {
        "name": "write_memory",
        "description": (
            "Write or overwrite a per-user memory file. Any .md filename is allowed except "
            "SOUL.md and HEARTBEAT.md (shared read-only system files). "
            "Universal files: STRATEGY.md, JOURNAL.md, LEARNINGS.md. "
            "Strategy-specific files (e.g. HOLDINGS.md, MARKET.md, THESIS.md) can be created freely."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Any .md filename. Must end in .md. SOUL.md and HEARTBEAT.md are not writable.",
                },
                "content":  {"type": "string"},
            },
            "required": ["filename", "content"],
        },
    },
    {
        "name": "append_journal",
        "description": "Append a trade entry to JOURNAL.md.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry": {"type": "string", "description": "Formatted journal entry to append"}
            },
            "required": ["entry"],
        },
    },
    {
        "name": "get_index_quote",
        "description": "Get the current LTP for a major NSE index (NIFTY50, BANKNIFTY, or FINNIFTY).",
        "input_schema": {
            "type": "object",
            "properties": {
                "index": {
                    "type": "string",
                    "enum": ["NIFTY50", "BANKNIFTY", "FINNIFTY"],
                    "default": "NIFTY50",
                }
            },
            "required": [],
        },
    },
    {
        "name": "write_trigger",
        "description": (
            "Set a monitoring condition. Heartbeat checks every 5 minutes.\n\n"
            "Triggers are one-shot — they fire once and are removed. If you are invoked "
            "by a trigger and decide not to act, re-call write_trigger to keep monitoring.\n\n"
            "mode='soft' (default): invokes the Claude agent when the condition fires.\n"
            "mode='hard': executes an action directly (no LLM):\n"
            "  action='place_trade' (default): executes place_trade() — requires type='price_in_range' "
            "  plus all trade fields (security_id, transaction_type, entry_min, entry_max, "
            "  stop_loss_price, target_price, quantity, thesis). Optional: rsi_max, candle_close_above.\n"
            "  action='exit_all': exits all open positions — use for EOD hard exits. Works with "
            "  any trigger type, typically type='time'. Example: set eod-exit trigger each morning "
            "  with type='time', at='15:10', mode='hard', action='exit_all'.\n\n"
            "Soft trigger types: time (at), price_above/below (symbol, threshold), "
            "index_above/below (symbol, threshold), near_stop/near_target (symbol, buffer_pct), "
            "day_pnl_above/below (threshold), position_pnl_pct (symbol, above_pct).\n\n"
            "Always set expires_at to today 15:00 IST (or today 23:59 for EOD exit triggers)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "id":         {"type": "string"},
                "type":       {"type": "string", "enum": [
                    "time", "price_above", "price_below", "price_in_range",
                    "index_above", "index_below",
                    "near_stop", "near_target",
                    "day_pnl_above", "day_pnl_below",
                    "position_pnl_pct",
                ]},
                "mode":       {"type": "string", "enum": ["soft", "hard"], "default": "soft"},
                "action":     {"type": "string", "enum": ["place_trade", "exit_all"], "default": "place_trade",
                               "description": "What to do when this hard trigger fires. 'place_trade' (default) or 'exit_all' (EOD exit)."},
                "reason":     {"type": "string"},
                "expires_at": {"type": "string", "description": "ISO 8601 datetime. Today 15:00 IST for most triggers; today 23:59 IST for EOD exit triggers."},
                "symbol":     {"type": "string"},
                "threshold":  {"type": "number"},
                "at":         {"type": "string", "description": "'HH:MM' IST"},
                "buffer_pct": {"type": "number"},
                "above_pct":  {"type": "number"},
                # hard-trigger fields (action="place_trade")
                "security_id":        {"type": "string"},
                "transaction_type":   {"type": "string", "enum": ["BUY", "SELL"]},
                "entry_min":          {"type": "number"},
                "entry_max":          {"type": "number"},
                "stop_loss_price":    {"type": "number"},
                "target_price":       {"type": "number"},
                "quantity":           {"type": "integer"},
                "thesis":             {"type": "string"},
                "rsi_max":            {"type": "number"},
                "candle_close_above": {"type": "number"},
            },
            "required": ["id", "type", "reason", "expires_at"],
        },
    },
    {
        "name": "remove_trigger",
        "description": "Remove a monitoring trigger by id.",
        "input_schema": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    },
    {
        "name": "list_triggers",
        "description": "Return all currently active monitoring triggers.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "write_schedule",
        "description": (
            "Create or update a recurring scheduled job. The job is stored in SCHEDULE.json "
            "and registered in APScheduler immediately — it will fire on every matching cron slot.\n\n"
            "All scheduled jobs are job_type='custom'. You write the prompt — it becomes your "
            "full instruction when the job fires. STRATEGY.md is always loaded into context "
            "automatically; call read_memory() inside the job for any other files you need.\n\n"
            "Write prompts as if instructing yourself: what to read, what to analyse, what actions "
            "to take. Be specific — a vague prompt produces vague results.\n\n"
            "Always propose the schedule to the user in chat and wait for agreement before calling "
            "this tool. Never create schedules unilaterally."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "id":       {"type": "string", "description": "Unique identifier for this schedule entry, e.g. 'premarket-daily'"},
                "cron":     {"type": "string", "description": "5-field cron: 'minute hour dom month dow', e.g. '45 8 * * 1-5'"},
                "job_type": {"type": "string", "enum": ["custom"], "description": "Always 'custom'."},
                "reason":   {"type": "string", "description": "One-line description of why this job exists"},
                "prompt":   {"type": "string", "description": "Required. The full instruction for what to do when this job fires."},
            },
            "required": ["id", "cron", "job_type", "reason", "prompt"],
        },
    },
    {
        "name": "remove_schedule",
        "description": "Remove a recurring scheduled job by id. Also removes it from APScheduler immediately.",
        "input_schema": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    },
    {
        "name": "list_schedules",
        "description": "Return all recurring scheduled jobs for the current user.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]
