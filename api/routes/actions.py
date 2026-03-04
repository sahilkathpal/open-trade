from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel

from api.auth import get_current_uid
from agent.tools import get_pending_approvals, save_pending_approvals, place_trade, reset_agent_pnl, _save_triggers
from agent.runner import run
from api import activity_log
from api.routes.state import _scheduler_status, _set_user_ctx_for_uid

router = APIRouter()


class ProposalIn(BaseModel):
    symbol: str
    security_id: str
    transaction_type: str = "BUY"
    quantity: int
    entry_price: float
    stop_loss_price: float
    thesis: str
    target_price: float = 0.0


@router.post("/api/proposals")
def inject_proposal(
    proposal: ProposalIn,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """Manually inject a trade proposal (e.g. after process restart)."""
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        symbol = proposal.symbol.upper()
        pending = get_pending_approvals()
        pending[symbol] = proposal.model_dump()
        pending[symbol]["symbol"] = symbol
        save_pending_approvals(pending)
        activity_log.emit({"type": "proposal", "symbol": symbol, "summary": f"Proposal injected: {symbol}"})
        return {"status": "ok", "symbol": symbol}
    finally:
        reset_user_ctx(token)


@router.post("/api/approve/{symbol}")
def approve_trade(
    symbol: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        symbol = symbol.upper()
        pending = get_pending_approvals()
        if symbol not in pending:
            raise HTTPException(status_code=404, detail=f"No pending approval for {symbol}")
        params = pending.pop(symbol)
        save_pending_approvals(pending)
        result = place_trade(**params, approved=True)
        activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Trade approved: {symbol}"})
        return result
    finally:
        reset_user_ctx(token)


@router.post("/api/deny/{symbol}")
def deny_trade(
    symbol: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        symbol = symbol.upper()
        pending = get_pending_approvals()
        if pending.pop(symbol, None) is None:
            raise HTTPException(status_code=404, detail=f"No pending approval for {symbol}")
        save_pending_approvals(pending)
        activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Trade denied: {symbol}"})
        return {"status": "denied", "symbol": symbol}
    finally:
        reset_user_ctx(token)


@router.post("/api/exit/{symbol}")
def exit_trade(
    symbol: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """Emergency exit — sell market order for a tracked position."""
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        symbol = symbol.upper()
        from agent.heartbeat import load_tracked_positions
        from agent.tools import exit_position
        tracked = load_tracked_positions()
        if symbol not in tracked:
            raise HTTPException(status_code=404, detail=f"No tracked position for {symbol}")
        pos = tracked[symbol]
        result = exit_position(symbol, pos["security_id"], pos["quantity"], "Manual web exit")
        activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Manual exit: {symbol}"})
        return result
    finally:
        reset_user_ctx(token)


@router.post("/api/run/{job_type}")
def trigger_job(
    job_type: str,
    background_tasks: BackgroundTasks,
    uid: Annotated[str, Depends(get_current_uid)],
):
    if job_type not in ("catchup",):
        raise HTTPException(status_code=400, detail=f"Unknown job_type: {job_type}")

    def _run():
        from agent.user_context import reset_user_ctx
        token, _ctx = _set_user_ctx_for_uid(uid)
        activity_log.emit({"type": "job_start", "summary": f"{job_type} started"})
        try:
            # Catchup starts a fresh session — clear stale data from previous day
            save_pending_approvals({})
            _save_triggers([])
            reset_agent_pnl()
            run(job_type)
            _scheduler_status[f"last_{job_type}"] = datetime.now(timezone.utc).isoformat()
            activity_log.emit({"type": "job_end", "summary": f"{job_type} complete"})
        except Exception as e:
            activity_log.emit({"type": "error", "summary": f"{job_type} failed: {e}"})
        finally:
            reset_user_ctx(token)

    background_tasks.add_task(_run)
    return {"status": "started", "job": job_type}


@router.post("/api/pause")
def pause_agent(uid: Annotated[str, Depends(get_current_uid)]):
    from agent.firestore import is_enabled, update_user
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    reset_user_ctx(token)
    if is_enabled() and uid != "default":
        update_user(uid, {"paused": True})
    return {"status": "paused"}


@router.post("/api/resume")
def resume_agent(uid: Annotated[str, Depends(get_current_uid)]):
    from agent.firestore import is_enabled, update_user
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    reset_user_ctx(token)
    if is_enabled() and uid != "default":
        update_user(uid, {"paused": False})
    return {"status": "resumed"}


