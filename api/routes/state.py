from fastapi import APIRouter
from agent.tools import get_funds, get_positions, get_market_quote, pending_approvals
from agent.heartbeat import load_tracked_positions, _ltp_from_quote
from agent.scheduler import _is_market_open, scheduler
from api.token_usage import get_today as get_today_usage, get_all as get_all_usage

router = APIRouter()

# Track last run times (module-level, updated by actions route)
_scheduler_status = {
    "last_premarket": None,
    "last_heartbeat": None,
    "last_eod": None,
}

def _build_positions() -> list[dict]:
    """
    Build UI-friendly position objects from OPEN_POSITIONS.json + live quotes.
    Returns [] if no tracked positions.
    """
    tracked = load_tracked_positions()
    if not tracked:
        return []

    # Confirm which symbols are actually still open on Dhan
    live = get_positions()
    live_symbols: set[str] = set()
    if live and not (len(live) == 1 and isinstance(live[0], dict) and live[0].get("error")):
        for p in live:
            sym = p.get("tradingSymbol") or p.get("symbol", "")
            qty = p.get("netQty") or p.get("quantity", 0)
            if sym and int(qty) != 0:
                live_symbols.add(sym)

    result = []
    for symbol, pos in tracked.items():
        if symbol not in live_symbols:
            continue  # already closed on exchange
        entry   = pos["entry_price"]
        sl      = pos["stop_loss_price"]
        target  = pos.get("target_price", 0.0)
        qty     = pos["quantity"]

        # Get live price
        quote = get_market_quote([symbol])
        ltp = _ltp_from_quote(quote) or entry  # fallback to entry if quote fails
        pnl = round((ltp - entry) * qty, 2)

        result.append({
            "symbol":          symbol,
            "entry_price":     entry,
            "current_price":   ltp,
            "quantity":        qty,
            "pnl":             pnl,
            "stop_loss_price": sl,
            "target_price":    target,
        })
    return result


@router.get("/api/state")
def get_state():
    try:
        capital = get_funds()
    except Exception as e:
        capital = {"available_balance": 0, "used_margin": 0, "day_pnl": 0, "error": str(e)}

    try:
        positions = _build_positions()
    except Exception as e:
        positions = []


    upcoming_jobs = []
    try:
        for job in sorted(scheduler.get_jobs(), key=lambda j: j.next_run_time or 0):
            if job.next_run_time:
                upcoming_jobs.append({
                    "id": job.id,
                    "next_run": job.next_run_time.isoformat(),
                })
    except Exception:
        pass

    return {
        "capital": capital,
        "positions": positions,
        "pending_approvals": pending_approvals,
        "market_open": _is_market_open(),
        "scheduler_status": _scheduler_status,
        "upcoming_jobs": upcoming_jobs,
        "token_usage": get_today_usage(),
    }


@router.get("/api/usage")
def get_usage():
    """Full token usage history, all days."""
    return get_all_usage()


@router.get("/api/usage/today")
def get_usage_today():
    """Today's token usage summary."""
    return get_today_usage()
