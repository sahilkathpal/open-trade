from fastapi import APIRouter
from agent.tools import get_funds, get_positions, pending_approvals
from agent.scheduler import _is_market_open
from api.token_usage import get_today as get_today_usage, get_all as get_all_usage

router = APIRouter()

# Track last run times (module-level, updated by actions route)
_scheduler_status = {
    "last_premarket": None,
    "last_heartbeat": None,
    "last_eod": None,
}

@router.get("/api/state")
def get_state():
    try:
        capital = get_funds()
    except Exception as e:
        capital = {"available_balance": 0, "used_margin": 0, "day_pnl": 0, "error": str(e)}

    try:
        positions = get_positions()
    except Exception as e:
        positions = []

    return {
        "capital": capital,
        "positions": positions,
        "pending_approvals": pending_approvals,
        "market_open": _is_market_open(),
        "scheduler_status": _scheduler_status,
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
