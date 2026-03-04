"""
Deterministic heartbeat monitor — minimal LLM calls.

Runs every 5 minutes during market hours. Checks:
1. Token expiry
2. Daily loss limit
3. Open position hard exits (stop loss / target / profit lock)
4. TRIGGERS.json — hard triggers execute directly, soft triggers invoke Claude

Position metadata (entry, SL, target) is written to memory/{uid}/OPEN_POSITIONS.json
by place_trade() and cleaned up by exit_position().
"""
import logging
from datetime import datetime, timedelta
from pathlib import Path
import json

import pytz

from agent.tools import (
    get_positions, get_market_quote, get_historical_data, get_funds,
    exit_position, place_trade,
    get_index_quote, load_triggers, _save_triggers, _load_agent_pnl,
    _append_activity,
)
from agent.user_context import get_user_ctx

IST = pytz.timezone("Asia/Kolkata")
logger = logging.getLogger(__name__)


def load_tracked_positions() -> dict:
    """Load locally tracked position metadata (entry, SL, target)."""
    path = get_user_ctx().memory_dir / "OPEN_POSITIONS.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {}


def _ltp_from_quote(quote: dict) -> float | None:
    """
    Extract LTP from a get_market_quote() or get_index_quote() response.

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


def _evaluate_triggers(
    now: datetime,
    tracked: dict,
    live_symbols: set,
    day_pnl: float,
    ltp_cache: dict,
    is_entry_window: bool = True,
) -> list[str]:
    """
    Evaluate TRIGGERS.json conditions. Hard triggers (mode='hard') execute
    place_trade() directly; soft triggers (mode='soft') invoke the Claude agent.
    Fired and expired triggers are removed; remaining triggers are saved back.
    """
    triggers = load_triggers()
    if not triggers:
        return []

    alerts = []
    remaining = []
    index_cache: dict[str, float] = {}

    for trigger in triggers:
        tid    = trigger.get("id", "?")
        ttype  = trigger.get("type", "")
        reason = trigger.get("reason", "")
        exp_str = trigger.get("expires_at", "")

        # ── expiry check ───────────────────────────────────────────────────
        if exp_str:
            try:
                exp = datetime.fromisoformat(exp_str)
                if exp.tzinfo is None:
                    exp = IST.localize(exp)
                if now > exp:
                    logger.debug("Trigger %s expired — discarding", tid)
                    _append_activity(f"TRIGGER EXPIRED id={tid} reason={reason}")
                    continue
            except Exception:
                pass

        fired   = False
        context = ""

        # ── time ───────────────────────────────────────────────────────────
        if ttype == "time":
            at_str = trigger.get("at", "")
            try:
                h, m = map(int, at_str.split(":"))
                trigger_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
                if now >= trigger_dt:
                    fired = True
                    context = f"Time trigger: {at_str} IST (now {now.strftime('%H:%M')} IST)"
            except Exception:
                pass

        # ── price_above / price_below ──────────────────────────────────────
        elif ttype in ("price_above", "price_below"):
            symbol    = trigger.get("symbol", "")
            threshold = trigger.get("threshold", 0)
            ltp = ltp_cache.get(symbol)
            if ltp is None:
                ltp = _ltp_from_quote(get_market_quote([symbol]))
                if ltp is not None:
                    ltp_cache[symbol] = ltp
            if ltp is not None:
                if ttype == "price_above" and ltp >= threshold:
                    fired = True
                    context = f"{symbol} LTP ₹{ltp:.2f} ≥ ₹{threshold:.2f}"
                elif ttype == "price_below" and ltp <= threshold:
                    fired = True
                    context = f"{symbol} LTP ₹{ltp:.2f} ≤ ₹{threshold:.2f}"

        # ── price_in_range (hard trigger) ─────────────────────────────────
        elif ttype == "price_in_range":
            if not is_entry_window:
                remaining.append(trigger)
                continue
            symbol    = trigger.get("symbol", "")
            entry_min = trigger.get("entry_min", 0)
            entry_max = trigger.get("entry_max", float("inf"))
            ltp = ltp_cache.get(symbol)
            if ltp is None:
                ltp = _ltp_from_quote(get_market_quote([symbol]))
                if ltp is not None:
                    ltp_cache[symbol] = ltp
            if ltp is not None and entry_min <= ltp <= entry_max:
                # optional guards
                rsi_max     = trigger.get("rsi_max")
                close_above = trigger.get("candle_close_above")
                guards_ok   = True
                if rsi_max or close_above:
                    hist = get_historical_data(symbol, interval="15", days=1)
                    if isinstance(hist, dict) and not hist.get("error"):
                        if rsi_max:
                            rsi = hist.get("indicators", {}).get("RSI_14")
                            if rsi and rsi > rsi_max:
                                guards_ok = False
                                logger.debug("%s RSI %.1f > max %.1f — skipping", symbol, rsi, rsi_max)
                        if close_above and guards_ok:
                            candles = hist.get("recent_candles", [])
                            if not candles or candles[-1].get("close", 0) < close_above:
                                guards_ok = False
                                logger.debug("%s candle close below %.2f — skipping", symbol, close_above)
                if guards_ok:
                    fired   = True
                    context = f"{symbol} LTP ₹{ltp:.2f} in range ₹{entry_min}–₹{entry_max}"

        # ── index_above / index_below ──────────────────────────────────────
        elif ttype in ("index_above", "index_below"):
            index     = trigger.get("symbol", "NIFTY50")
            threshold = trigger.get("threshold", 0)
            ltp = index_cache.get(index)
            if ltp is None:
                ltp = _ltp_from_quote(get_index_quote(index))
                if ltp is not None:
                    index_cache[index] = ltp
            if ltp is not None:
                if ttype == "index_above" and ltp >= threshold:
                    fired = True
                    context = f"{index} ₹{ltp:.2f} ≥ ₹{threshold:.2f}"
                elif ttype == "index_below" and ltp <= threshold:
                    fired = True
                    context = f"{index} ₹{ltp:.2f} ≤ ₹{threshold:.2f}"

        # ── near_stop / near_target ────────────────────────────────────────
        elif ttype in ("near_stop", "near_target"):
            symbol     = trigger.get("symbol", "")
            buffer_pct = trigger.get("buffer_pct", 0.5) / 100
            pos = tracked.get(symbol)
            if not pos or symbol not in live_symbols:
                logger.debug("Trigger %s: %s not open — discarding", tid, symbol)
                continue
            ltp = ltp_cache.get(symbol)
            if ltp is None:
                ltp = _ltp_from_quote(get_market_quote([symbol]))
                if ltp is not None:
                    ltp_cache[symbol] = ltp
            if ltp is not None:
                if ttype == "near_stop":
                    sl = pos["stop_loss_price"]
                    if ltp <= sl * (1 + buffer_pct):
                        fired = True
                        context = (
                            f"{symbol} LTP ₹{ltp:.2f} within "
                            f"{trigger.get('buffer_pct', 0.5):.1f}% of stop ₹{sl:.2f}"
                        )
                else:  # near_target
                    target = pos.get("target_price", 0)
                    if target and ltp >= target * (1 - buffer_pct):
                        fired = True
                        context = (
                            f"{symbol} LTP ₹{ltp:.2f} within "
                            f"{trigger.get('buffer_pct', 0.5):.1f}% of target ₹{target:.2f}"
                        )

        # ── day_pnl_above / day_pnl_below ─────────────────────────────────
        elif ttype == "day_pnl_above":
            threshold = trigger.get("threshold", 0)
            if day_pnl >= threshold:
                fired = True
                context = f"Day P&L ₹{day_pnl:.2f} ≥ ₹{threshold:.2f}"

        elif ttype == "day_pnl_below":
            threshold = trigger.get("threshold", 0)
            if day_pnl <= threshold:
                fired = True
                context = f"Day P&L ₹{day_pnl:.2f} ≤ ₹{threshold:.2f}"

        # ── position_pnl_pct ───────────────────────────────────────────────
        elif ttype == "position_pnl_pct":
            symbol    = trigger.get("symbol", "")
            above_pct = trigger.get("above_pct", 0) / 100
            pos = tracked.get(symbol)
            if not pos or symbol not in live_symbols:
                logger.debug("Trigger %s: %s not open — discarding", tid, symbol)
                continue
            ltp = ltp_cache.get(symbol)
            if ltp is None:
                ltp = _ltp_from_quote(get_market_quote([symbol]))
                if ltp is not None:
                    ltp_cache[symbol] = ltp
            if ltp is not None:
                entry   = pos["entry_price"]
                pnl_pct = (ltp - entry) / entry * 100
                if pnl_pct >= above_pct:
                    fired = True
                    context = (
                        f"{symbol} position +{pnl_pct:.1f}% "
                        f"(entry ₹{entry:.2f}, LTP ₹{ltp:.2f})"
                    )

        # ── fire ───────────────────────────────────────────────────────────
        if fired:
            logger.info("Trigger %s fired: %s", tid, context)
            _append_activity(f"TRIGGER FIRED id={tid} mode={trigger.get('mode', 'soft')} context={context}")
            tmode  = trigger.get("mode", "soft")
            action = trigger.get("action", "place_trade")
            if tmode == "hard":
                if action == "exit_all":
                    # Exit all tracked positions — EOD hard exit
                    tracked_for_exit = load_tracked_positions()
                    if not tracked_for_exit:
                        alerts.append(f"HARD TRIGGER [{tid}]: exit_all — no open positions")
                    else:
                        for sym, pos in tracked_for_exit.items():
                            try:
                                result = exit_position(
                                    sym, pos["security_id"], pos["quantity"],
                                    f"Hard trigger EOD exit [{tid}]"
                                )
                                logger.info("EOD exit %s: %s", sym, result)
                            except Exception as e:
                                logger.error("Hard trigger %s: exit_position %s failed: %s", tid, sym, e)
                        alerts.append(f"HARD TRIGGER [{tid}]: exit all positions ({len(tracked_for_exit)} symbols)")
                else:
                    # action="place_trade" — execute trade directly
                    symbol = trigger.get("symbol", "")
                    ltp    = ltp_cache.get(symbol)
                    try:
                        result = place_trade(
                            symbol=symbol,
                            security_id=trigger["security_id"],
                            transaction_type=trigger.get("transaction_type", "BUY"),
                            quantity=trigger["quantity"],
                            entry_price=ltp,
                            stop_loss_price=trigger["stop_loss_price"],
                            target_price=trigger["target_price"],
                            thesis=trigger["thesis"],
                        )
                        status = result.get("status", "unknown") if isinstance(result, dict) else str(result)
                        alerts.append(f"HARD TRIGGER [{tid}] {symbol} @ ₹{ltp:.2f} — {status}")
                        logger.info("Hard trigger trade %s: %s", symbol, result)
                    except Exception as e:
                        logger.error("Hard trigger %s: place_trade failed: %s", tid, e)
                        alerts.append(f"HARD TRIGGER [{tid}] ERROR: {e}")
            else:
                try:
                    from agent.runner import run as agent_run
                    extra = (
                        f"Trigger fired: {context}\n"
                        f"Your original note when setting this trigger: {reason}"
                    )
                    agent_run("trigger", extra_prompt=extra)
                    alerts.append(f"TRIGGER [{tid}]: {context}")
                except Exception as e:
                    logger.error("Trigger %s: agent invocation failed: %s", tid, e)
                    alerts.append(f"TRIGGER [{tid}] ERROR: {e}")
        else:
            remaining.append(trigger)

    _save_triggers(remaining)
    return alerts


def run() -> str:
    """
    Run the deterministic heartbeat for the current UserContext.
    Returns 'HEARTBEAT_OK' or a description of actions taken / alerts raised.
    """
    ctx = get_user_ctx()
    now = datetime.now(IST)
    alerts: list[str] = []
    ltp_cache: dict[str, float] = {}

    # ── 1. Token expiry check — abort before any trading logic ────────────
    funds = get_funds()
    if isinstance(funds, dict) and funds.get("token_expired"):
        alert_flag = ctx.memory_dir / ".token_expired_alerted"
        last_alert = float(alert_flag.read_text()) if alert_flag.exists() else 0.0
        if (now.timestamp() - last_alert) > 86400:  # alert at most once per day
            alert_flag.write_text(str(now.timestamp()))
            return "TOKEN_EXPIRED: Your Dhan access token has expired. Update it in Settings to resume trading."
        return "HEARTBEAT_OK"

    # ── 2. Compute day P&L for trigger evaluation (no halt — max_drawdown in RiskGuard) ──
    pnl_data = _load_agent_pnl()
    tracked_symbols: set[str] = set(pnl_data.get("tracked_symbols", []))
    day_pnl = 0.0
    if tracked_symbols:
        try:
            live_for_pnl = get_positions()
            if live_for_pnl and not (len(live_for_pnl) == 1 and isinstance(live_for_pnl[0], dict) and live_for_pnl[0].get("error")):
                for p in live_for_pnl:
                    sym = p.get("tradingSymbol") or p.get("symbol", "")
                    if sym in tracked_symbols:
                        day_pnl += float(p.get("realizedProfit", 0) or 0)
                        day_pnl += float(p.get("unrealizedProfit", 0) or 0)
        except Exception:
            pass
    # Note: daily_loss_limit removed — max_drawdown_pct is enforced in RiskGuard.validate()

    # ── 3. Open position hard exits ────────────────────────────────────────
    tracked = load_tracked_positions()
    live_symbols: set[str] = set()

    if tracked:
        live = get_positions()
        if live and not (len(live) == 1 and isinstance(live[0], dict) and live[0].get("error")):
            for p in live:
                sym = p.get("tradingSymbol") or p.get("symbol", "")
                qty = p.get("netQty") or p.get("quantity", 0)
                if sym and int(qty) != 0:
                    live_symbols.add(sym)

        for symbol, pos in tracked.items():
            if symbol not in live_symbols:
                logger.debug("%s not in live positions — skipping", symbol)
                continue

            sec_id = pos["security_id"]
            qty    = pos["quantity"]
            entry  = pos["entry_price"]
            sl     = pos["stop_loss_price"]
            target = pos.get("target_price", 0.0)

            ltp = _ltp_from_quote(get_market_quote([symbol]))
            if ltp is not None:
                ltp_cache[symbol] = ltp

            if ltp is None:
                alerts.append(f"WARN: could not get quote for {symbol}")
                continue

            logger.debug("%s LTP=%.2f entry=%.2f SL=%.2f target=%.2f", symbol, ltp, entry, sl, target)

            if ltp <= sl:
                realized = (ltp - entry) * qty  # negative for losses
                result = exit_position(symbol, sec_id, qty, f"Stop loss hit: LTP ₹{ltp:.2f} ≤ SL ₹{sl:.2f}", realized_pnl=realized)
                alerts.append(f"SL hit {symbol}: exit @ ₹{ltp:.2f} (SL ₹{sl:.2f})")
                logger.info("Stop loss exit %s: %s", symbol, result)
                continue

            if target and ltp >= target:
                realized = (ltp - entry) * qty  # positive
                result = exit_position(symbol, sec_id, qty, f"Target reached: LTP ₹{ltp:.2f} ≥ target ₹{target:.2f}", realized_pnl=realized)
                alerts.append(f"Target {symbol}: exit @ ₹{ltp:.2f} (target ₹{target:.2f})")
                logger.info("Target exit %s: %s", symbol, result)
                continue

    # ── 4. Triggers (hard + soft) ──────────────────────────────────────────
    # Entry window for price_in_range triggers: 9:45 AM to 3:10 PM IST
    is_entry_window = (9, 45) <= (now.hour, now.minute) < (15, 10)
    trigger_alerts = _evaluate_triggers(now, tracked, live_symbols, day_pnl, ltp_cache, is_entry_window)
    alerts.extend(trigger_alerts)

    if alerts:
        return "\n".join(alerts)
    return "HEARTBEAT_OK"
