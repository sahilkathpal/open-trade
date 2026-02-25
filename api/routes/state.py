from typing import Annotated

from fastapi import APIRouter, Depends

from api.auth import get_current_uid
from agent.tools import get_funds, get_positions, get_pending_approvals, load_watchlist, load_triggers, _load_agent_pnl
from agent.heartbeat import load_tracked_positions
from agent.scheduler import _is_market_open, scheduler
from api.token_usage import get_today as get_today_usage, get_all as get_all_usage

router = APIRouter()

# Track last run times (updated by actions route)
_scheduler_status = {
    "last_premarket": None,
    "last_heartbeat": None,
    "last_eod": None,
}


def _build_positions_and_agent_pnl() -> tuple[list[dict], dict]:
    """
    Build UI position objects and compute agent P&L in a single get_positions() call.
    Agent P&L uses Dhan's own realizedProfit / unrealizedProfit for tracked symbols.
    """
    tracked = load_tracked_positions()
    pnl_data = _load_agent_pnl()
    tracked_symbols: set[str] = set(pnl_data.get("tracked_symbols", []))

    _zero_pnl = {"realized": 0.0, "unrealized": 0.0, "total": 0.0}

    if not tracked and not tracked_symbols:
        return [], _zero_pnl

    live = get_positions()
    live_map: dict[str, dict] = {}   # symbol → Dhan position row
    if live and not (len(live) == 1 and isinstance(live[0], dict) and live[0].get("error")):
        for p in live:
            sym = p.get("tradingSymbol") or p.get("symbol", "")
            if sym:
                live_map[sym] = p

    # ── UI positions (tracked + still open) ───────────────────────────────
    result = []
    for symbol, pos in (tracked or {}).items():
        dhan_pos = live_map.get(symbol)
        if not dhan_pos:
            continue
        net_qty = dhan_pos.get("netQty") or dhan_pos.get("quantity", 0)
        if int(net_qty) == 0:
            continue
        entry  = pos["entry_price"]
        sl     = pos["stop_loss_price"]
        target = pos.get("target_price", 0.0)
        qty    = pos["quantity"]
        # Use Dhan's own ltp and unrealizedProfit — exact, no extra quote call
        ltp = float(dhan_pos.get("ltp") or 0) or entry
        pnl = round(float(dhan_pos.get("unrealizedProfit") or 0), 2)
        result.append({
            "symbol":          symbol,
            "entry_price":     entry,
            "current_price":   ltp,
            "quantity":        qty,
            "pnl":             pnl,
            "stop_loss_price": sl,
            "target_price":    target,
        })

    # ── Agent P&L from Dhan's own numbers for tracked symbols ─────────────
    realized   = 0.0
    unrealized = 0.0
    for sym in tracked_symbols:
        dhan_pos = live_map.get(sym)
        if dhan_pos is None:
            continue
        realized   += float(dhan_pos.get("realizedProfit",   0) or 0)
        unrealized += float(dhan_pos.get("unrealizedProfit", 0) or 0)

    agent_pnl = {
        "realized":   round(realized, 2),
        "unrealized": round(unrealized, 2),
        "total":      round(realized + unrealized, 2),
    }
    return result, agent_pnl


def _set_user_ctx_for_uid(uid: str):
    """Create and set UserContext for the given uid. Returns the reset token."""
    from agent.user_context import set_user_ctx, _get_default_ctx, UserContext
    from agent.firestore import is_enabled, get_user

    if not is_enabled() or uid == "default":
        ctx = _get_default_ctx()
    else:
        doc = get_user(uid)
        ctx = UserContext(uid, doc or {})

    return set_user_ctx(ctx), ctx


@router.get("/api/state")
def get_state(uid: Annotated[str, Depends(get_current_uid)]):
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        try:
            capital = get_funds()
        except Exception as e:
            capital = {"available_balance": 0, "used_margin": 0, "day_pnl": 0, "error": str(e)}

        try:
            positions, agent_pnl = _build_positions_and_agent_pnl()
        except Exception:
            positions, agent_pnl = [], {"realized": 0.0, "unrealized": 0.0, "total": 0.0}

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

        from agent.user_context import get_user_ctx
        ctx = get_user_ctx()
        dhan_configured = ctx.dhan.configured
        token_expired = capital.get("token_expired", False)

        # catchup_available: broker connected + token valid + not paused + market open + no analysis today
        catchup_available = False
        if dhan_configured and not token_expired and not ctx.paused and _is_market_open():
            from datetime import datetime
            import pytz
            today = datetime.now(pytz.timezone("Asia/Kolkata")).strftime("%Y-%m-%d")
            market_md = ctx.memory_dir / "MARKET.md"
            if not market_md.exists() or today not in market_md.read_text():
                catchup_available = True

        return {
            "capital":           capital,
            "positions":         positions,
            "pending_approvals": get_pending_approvals(),
            "watchlist":         load_watchlist(),
            "triggers":          load_triggers(),
            "market_open":       _is_market_open(),
            "scheduler_status":  _scheduler_status,
            "upcoming_jobs":     upcoming_jobs,
            "token_usage":       get_today_usage(),
            "dhan_configured":   dhan_configured,
            "token_expired":     token_expired,
            "catchup_available": catchup_available,
            "agent_pnl":         agent_pnl,
            "daily_loss_limit":  abs(ctx.daily_loss_limit),
            "seed_capital":      ctx.risk.seed_capital,
            "autonomous":        ctx.autonomous,
            "paused":            ctx.paused,
        }
    finally:
        reset_user_ctx(token)


@router.get("/api/usage")
def get_usage():
    return get_all_usage()


@router.get("/api/usage/today")
def get_usage_today():
    return get_today_usage()
