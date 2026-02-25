"""
Deterministic heartbeat monitor — minimal LLM calls.

Runs every 5 minutes during market hours. Checks:
1. Daily loss limit
2. Open position hard exits (stop loss / target / profit lock / EOD)
3. Watchlist entry triggers (pure Python → place_trade)
4. TRIGGERS.json soft conditions → invoke Claude only when a condition fires

Position metadata (entry, SL, target) is written to memory/OPEN_POSITIONS.json
by place_trade() and cleaned up by exit_position().

Triggers are written to memory/TRIGGERS.json by Claude (via write_trigger tool)
and cleaned up here as they fire or expire.
"""
import logging
from datetime import datetime, timedelta
from pathlib import Path
import json

import pytz

from agent.tools import (
    get_positions, get_market_quote, get_historical_data, get_funds,
    exit_position, place_trade, load_watchlist, _save_watchlist,
    get_index_quote, load_triggers, _save_triggers,
)

IST = pytz.timezone("Asia/Kolkata")
logger = logging.getLogger(__name__)

OPEN_POSITIONS_PATH = Path("memory/OPEN_POSITIONS.json")

DAILY_LOSS_LIMIT = -500.0  # ₹ — halt all trading if breached
PROFIT_LOCK_PCT  = 0.04    # exit at +4% from entry
EOD_EXIT_HOUR    = 15
EOD_EXIT_MIN     = 10      # 3:10 PM IST — exit before 3:20 MIS auto-square-off


def load_tracked_positions() -> dict:
    """Load locally tracked position metadata (entry, SL, target)."""
    if OPEN_POSITIONS_PATH.exists():
        try:
            return json.loads(OPEN_POSITIONS_PATH.read_text())
        except Exception:
            pass
    return {}


def _ltp_from_quote(quote: dict) -> float | None:
    """
    Extract LTP from a get_market_quote() or get_index_quote() response.
    Dhan returns data keyed by security_id; sandbox mock keys by symbol.
    Walk all values to find the first ltp.
    """
    if not isinstance(quote, dict):
        return None
    data = quote.get("data", {})
    for val in data.values():
        if isinstance(val, dict):
            ltp = val.get("ltp") or val.get("last_price")
            if ltp is not None:
                return float(ltp)
    return None


def _evaluate_triggers(
    now: datetime,
    tracked: dict,
    live_symbols: set,
    day_pnl: float,
    ltp_cache: dict,
) -> list[str]:
    """
    Evaluate TRIGGERS.json conditions. For any that fire, invoke Claude via
    agent.runner.run() with the trigger's reason as context. Fired and expired
    triggers are removed; remaining triggers are saved back.
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
                if timedelta(0) <= (now - trigger_dt) < timedelta(minutes=5):
                    fired = True
                    context = f"Time trigger: {at_str} IST"
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
                # Position closed — discard trigger silently
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
            # Trigger consumed — do not re-add to remaining
        else:
            remaining.append(trigger)

    _save_triggers(remaining)
    return alerts


def run() -> str:
    """
    Run the deterministic heartbeat.
    Returns 'HEARTBEAT_OK' or a description of actions taken / alerts raised.
    """
    now = datetime.now(IST)
    alerts: list[str] = []
    ltp_cache: dict[str, float] = {}  # shared across sections to avoid duplicate quotes

    # ── 1. Daily loss limit ────────────────────────────────────────────────
    funds = get_funds()
    day_pnl = 0.0
    if isinstance(funds, dict) and not funds.get("error"):
        day_pnl = funds.get("day_pnl", 0.0)
        if day_pnl < DAILY_LOSS_LIMIT:
            return f"HALT: Daily loss limit breached. day_pnl=₹{day_pnl:.2f}"

    is_eod = (now.hour, now.minute) >= (EOD_EXIT_HOUR, EOD_EXIT_MIN)

    # ── 2. Open position hard exits ────────────────────────────────────────
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

            # EOD: exit all positions before MIS auto-square-off
            if is_eod:
                result = exit_position(symbol, sec_id, qty, "MIS EOD exit — 3:10 PM IST")
                alerts.append(f"EOD exit {symbol} @ ₹{ltp:.2f}")
                logger.info("EOD exit %s: %s", symbol, result)
                continue

            # Hard exits — pure Python, no LLM
            if ltp <= sl:
                result = exit_position(symbol, sec_id, qty, f"Stop loss hit: LTP ₹{ltp:.2f} ≤ SL ₹{sl:.2f}")
                alerts.append(f"SL hit {symbol}: exit @ ₹{ltp:.2f} (SL ₹{sl:.2f})")
                logger.info("Stop loss exit %s: %s", symbol, result)
                continue

            if target and ltp >= target:
                result = exit_position(symbol, sec_id, qty, f"Target reached: LTP ₹{ltp:.2f} ≥ target ₹{target:.2f}")
                alerts.append(f"Target {symbol}: exit @ ₹{ltp:.2f} (target ₹{target:.2f})")
                logger.info("Target exit %s: %s", symbol, result)
                continue

            if ltp >= entry * (1 + PROFIT_LOCK_PCT):
                result = exit_position(symbol, sec_id, qty, f"Profit lock +4%: LTP ₹{ltp:.2f}")
                alerts.append(f"Profit lock {symbol}: exit @ ₹{ltp:.2f} (+{((ltp/entry)-1)*100:.1f}% from ₹{entry:.2f})")
                logger.info("Profit lock exit %s: %s", symbol, result)
                continue

    # ── 3. Watchlist entry triggers ────────────────────────────────────────
    watchlist = load_watchlist()
    is_entry_window = (9, 45) <= (now.hour, now.minute) < (EOD_EXIT_HOUR, EOD_EXIT_MIN)

    if watchlist and is_entry_window:
        watchlist_dirty = False
        for symbol, cond in list(watchlist.items()):
            ltp = ltp_cache.get(symbol) or _ltp_from_quote(get_market_quote([symbol]))
            if ltp is not None:
                ltp_cache[symbol] = ltp
            if ltp is None:
                logger.warning("Could not get quote for watchlist symbol %s", symbol)
                continue

            if not (cond["entry_min"] <= ltp <= cond["entry_max"]):
                continue

            rsi_max     = cond.get("rsi_max")
            close_above = cond.get("candle_close_above")
            if rsi_max or close_above:
                hist = get_historical_data(symbol, interval="15", days=1)
                if isinstance(hist, dict) and not hist.get("error"):
                    if rsi_max:
                        rsi = hist.get("indicators", {}).get("RSI_14")
                        if rsi and rsi > rsi_max:
                            logger.debug("%s RSI %.1f > max %.1f — skipping", symbol, rsi, rsi_max)
                            continue
                    if close_above:
                        candles = hist.get("recent_candles", [])
                        if not candles or candles[-1].get("close", 0) < close_above:
                            logger.debug("%s latest candle close below %.2f — skipping", symbol, close_above)
                            continue

            result = place_trade(
                symbol=symbol,
                security_id=cond["security_id"],
                transaction_type="BUY",
                quantity=cond["quantity"],
                entry_price=ltp,
                stop_loss_price=cond["stop_loss_price"],
                target_price=cond["target_price"],
                thesis=cond["thesis"],
            )
            status = result.get("status", "unknown") if isinstance(result, dict) else str(result)
            alerts.append(f"WATCH triggered {symbol} @ ₹{ltp:.2f} — {status}")
            logger.info("Watchlist trade %s: %s", symbol, result)
            watchlist.pop(symbol)
            watchlist_dirty = True

        if watchlist_dirty:
            _save_watchlist(watchlist)

    # ── 4. Soft triggers → Claude review ──────────────────────────────────
    # Only evaluate triggers outside EOD window — positions are being exited anyway.
    if not is_eod:
        trigger_alerts = _evaluate_triggers(now, tracked, live_symbols, day_pnl, ltp_cache)
        alerts.extend(trigger_alerts)

    if alerts:
        return "\n".join(alerts)
    return "HEARTBEAT_OK"
