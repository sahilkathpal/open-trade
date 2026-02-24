from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from agent.tools import pending_approvals, place_trade, _save_pending
from agent.runner import run
from api import activity_log
from api.routes.state import _scheduler_status

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
def inject_proposal(proposal: ProposalIn):
    """Manually inject a trade proposal (e.g. from MARKET.md after process restart)."""
    symbol = proposal.symbol.upper()
    pending_approvals[symbol] = proposal.model_dump()
    pending_approvals[symbol]["symbol"] = symbol
    _save_pending()
    activity_log.emit({"type": "proposal", "symbol": symbol, "summary": f"Proposal injected: {symbol}"})
    return {"status": "ok", "symbol": symbol}


@router.post("/api/approve/{symbol}")
def approve_trade(symbol: str):
    symbol = symbol.upper()
    if symbol not in pending_approvals:
        raise HTTPException(status_code=404, detail=f"No pending approval for {symbol}")
    params = pending_approvals.pop(symbol)
    _save_pending()
    result = place_trade(**params, approved=True)
    activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Trade approved: {symbol}"})
    return result

@router.post("/api/deny/{symbol}")
def deny_trade(symbol: str):
    symbol = symbol.upper()
    if pending_approvals.pop(symbol, None) is None:
        raise HTTPException(status_code=404, detail=f"No pending approval for {symbol}")
    _save_pending()
    activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Trade denied: {symbol}"})
    return {"status": "denied", "symbol": symbol}

@router.post("/api/run/{job_type}")
def trigger_job(job_type: str, background_tasks: BackgroundTasks):
    if job_type not in ("premarket", "execution", "heartbeat", "eod"):
        raise HTTPException(status_code=400, detail=f"Unknown job_type: {job_type}")

    def _run():
        activity_log.emit({"type": "job_start", "summary": f"{job_type} started"})
        try:
            result = run(job_type)
            _scheduler_status[f"last_{job_type}"] = datetime.now(timezone.utc).isoformat()
            activity_log.emit({"type": "job_end", "summary": f"{job_type} complete"})
        except Exception as e:
            activity_log.emit({"type": "error", "summary": f"{job_type} failed: {e}"})

    background_tasks.add_task(_run)
    return {"status": "started", "job": job_type}
