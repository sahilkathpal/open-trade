"""
Deterministic heartbeat monitor — no LLM, pure Python.

Runs every 5 minutes during market hours. Checks:
1. Daily loss limit
2. Open position stop loss / target / profit lock / EOD exit

Position metadata (entry, SL, target) is written to memory/OPEN_POSITIONS.json
by place_trade() and cleaned up by exit_position().
"""
import json
import logging
from datetime import datetime
from pathlib import Path

import pytz

from agent.tools import get_positions, get_market_quote, get_historical_data, get_funds, exit_position, place_trade, load_watchlist, _save_watchlist

IST = pytz.timezone("Asia/Kolkata")
logger = logging.getLogger(__name__)

OPEN_POSITIONS_PATH = Path("memory/OPEN_POSITIONS.json")

DAILY_LOSS_LIMIT = -500.0  # ₹ — halt all trading if breached
PROFIT_LOCK_PCT  = 0.04    # exit at +4% from entry (trailing stop)
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
    Extract LTP from a get_market_quote() response.
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


def run() -> str:
    """
    Run the deterministic heartbeat.
    Returns 'HEARTBEAT_OK' or a description of actions taken / alerts raised.
    """
    now = datetime.now(IST)
    alerts: list[str] = []

    # ── 1. Daily loss limit ────────────────────────────────────────────────────
    funds = get_funds()
    if isinstance(funds, dict) and not funds.get("error"):
        day_pnl = funds.get("day_pnl", 0.0)
        if day_pnl < DAILY_LOSS_LIMIT:
            return f"HALT: Daily loss limit breached. day_pnl=₹{day_pnl:.2f}"

    # ── 2. Open position checks ────────────────────────────────────────────────
    tracked = load_tracked_positions()
    if not tracked:
        return "HEARTBEAT_OK"

    # Confirm which symbols are actually still open on Dhan
    live = get_positions()
    live_symbols: set[str] = set()
    if live and not (len(live) == 1 and isinstance(live[0], dict) and live[0].get("error")):
        for p in live:
            sym = p.get("tradingSymbol") or p.get("symbol", "")
            qty = p.get("netQty") or p.get("quantity", 0)
            if sym and int(qty) != 0:
                live_symbols.add(sym)

    is_eod = (now.hour, now.minute) >= (EOD_EXIT_HOUR, EOD_EXIT_MIN)

    for symbol, pos in tracked.items():
        if symbol not in live_symbols:
            # Position already closed on exchange (SL order triggered, or manual)
            logger.debug("%s not in live positions — skipping", symbol)
            continue

        sec_id  = pos["security_id"]
        qty     = pos["quantity"]
        entry   = pos["entry_price"]
        sl      = pos["stop_loss_price"]
        target  = pos.get("target_price", 0.0)

        quote = get_market_quote([symbol])
        ltp = _ltp_from_quote(quote)

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

        # Stop loss breached
        if ltp <= sl:
            result = exit_position(symbol, sec_id, qty, f"Stop loss hit: LTP ₹{ltp:.2f} ≤ SL ₹{sl:.2f}")
            alerts.append(f"SL hit {symbol}: exit @ ₹{ltp:.2f} (SL ₹{sl:.2f})")
            logger.info("Stop loss exit %s: %s", symbol, result)
            continue

        # Target reached
        if target and ltp >= target:
            result = exit_position(symbol, sec_id, qty, f"Target reached: LTP ₹{ltp:.2f} ≥ target ₹{target:.2f}")
            alerts.append(f"Target {symbol}: exit @ ₹{ltp:.2f} (target ₹{target:.2f})")
            logger.info("Target exit %s: %s", symbol, result)
            continue

        # Profit lock: +4% from entry
        if ltp >= entry * (1 + PROFIT_LOCK_PCT):
            result = exit_position(symbol, sec_id, qty, f"Profit lock +4%: LTP ₹{ltp:.2f}")
            alerts.append(f"Profit lock {symbol}: exit @ ₹{ltp:.2f} (+{((ltp/entry)-1)*100:.1f}% from ₹{entry:.2f})")
            logger.info("Profit lock exit %s: %s", symbol, result)
            continue

    # ── 3. Watchlist entry triggers ────────────────────────────────────────────
    # Only check between 9:45 AM and 3:10 PM — skip right at open (volatile)
    # and stop adding new positions once EOD exit window begins.
    watchlist = load_watchlist()
    is_entry_window = (9, 45) <= (now.hour, now.minute) < (EOD_EXIT_HOUR, EOD_EXIT_MIN)

    if watchlist and is_entry_window:
        watchlist_dirty = False
        for symbol, cond in list(watchlist.items()):
            quote = get_market_quote([symbol])
            ltp = _ltp_from_quote(quote)
            if ltp is None:
                logger.warning("Could not get quote for watchlist symbol %s", symbol)
                continue

            # Price range check
            if not (cond["entry_min"] <= ltp <= cond["entry_max"]):
                continue

            # Optional: RSI and/or candle close check
            rsi_max          = cond.get("rsi_max")
            close_above      = cond.get("candle_close_above")
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

            # All conditions met — place the trade
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

            # Remove from watchlist regardless of outcome — don't retry same bar
            watchlist.pop(symbol)
            watchlist_dirty = True

        if watchlist_dirty:
            _save_watchlist(watchlist)

    if alerts:
        return "\n".join(alerts)
    return "HEARTBEAT_OK"
