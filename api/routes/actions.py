from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel

from api.auth import get_current_uid
from agent.tools import get_pending_approvals, save_pending_approvals, place_trade, reset_agent_pnl, _save_triggers, get_approvals, resolve_approval, save_approvals, write_trigger
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
        # Try new APPROVALS.json first
        approvals = get_approvals()
        approval = next((a for a in approvals if a.get("symbol") == symbol and a.get("type") == "trade"), None)
        if approval:
            item = resolve_approval(approval["id"])
            if item:
                params = {k: v for k, v in item.items() if k not in ("id", "type", "created_at", "description")}
                result = place_trade(**params, approved=True)
                activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Trade approved: {symbol}"})
                return result
        # Fallback: old PENDING.json
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
        # Try new APPROVALS.json first
        approvals = get_approvals()
        approval = next((a for a in approvals if a.get("symbol") == symbol and a.get("type") == "trade"), None)
        if approval:
            resolve_approval(approval["id"])
            activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Trade denied: {symbol}"})
            return {"status": "denied", "symbol": symbol}
        # Fallback: old PENDING.json
        pending = get_pending_approvals()
        if pending.pop(symbol, None) is None:
            raise HTTPException(status_code=404, detail=f"No pending approval for {symbol}")
        save_pending_approvals(pending)
        activity_log.emit({"type": "trade", "symbol": symbol, "summary": f"Trade denied: {symbol}"})
        return {"status": "denied", "symbol": symbol}
    finally:
        reset_user_ctx(token)


@router.get("/api/approvals")
def list_approvals(uid: Annotated[str, Depends(get_current_uid)]):
    """List all non-expired approvals."""
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        return get_approvals()
    finally:
        reset_user_ctx(token)


class RespondIn(BaseModel):
    approved: bool


@router.post("/api/approvals/{approval_id}/respond")
def respond_approval(
    approval_id: str,
    body: RespondIn,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """Approve or deny an approval by id."""
    from agent.user_context import reset_user_ctx
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        item = resolve_approval(approval_id)
        if item is None:
            raise HTTPException(status_code=404, detail=f"Approval {approval_id} not found or expired")

        if not body.approved:
            activity_log.emit({"type": "trade", "symbol": item.get("symbol", ""), "summary": f"Denied: {item.get('description', approval_id)}"})
            return {"status": "denied", "id": approval_id}

        # Execute based on type
        item_type = item.get("type")
        if item_type == "trade":
            # Remove meta fields before calling place_trade
            params = {k: v for k, v in item.items() if k not in ("id", "type", "created_at", "description")}
            result = place_trade(**params, approved=True)
            activity_log.emit({"type": "trade", "symbol": item.get("symbol", ""), "summary": f"Approved: {item.get('description', approval_id)}"})
            return result
        elif item_type == "hard_trigger":
            # Reconstruct write_trigger call
            excluded = {"id", "type", "created_at", "description", "trigger_id"}
            params = {k: v for k, v in item.items() if k not in excluded}
            trigger_id = item.get("trigger_id", approval_id)
            result = write_trigger(id=trigger_id, approved=True, **params)
            activity_log.emit({"type": "tool_call", "tool": "write_trigger", "summary": f"Hard trigger approved: {trigger_id}"})
            return result
        elif item_type == "strategy_proposal":
            # Create the strategy in Firestore
            strategy_id = item.get("proposal_strategy_id") or item.get("strategy_id", "")
            if not strategy_id:
                raise HTTPException(status_code=400, detail="strategy_proposal missing proposal_strategy_id")
            from agent.firestore_strategies import create_strategy
            from agent.firestore import update_user, is_enabled
            doc = {
                "name": item.get("name", strategy_id),
                "thesis": item.get("thesis", ""),
                "rules": item.get("rules", ""),
                "capital_allocation": item.get("capital_allocation", 0.0),
                "risk_config": item.get("risk_config", {}),
                "status": "active",
            }
            ok = create_strategy(uid, strategy_id, doc)
            # Also update strategy_allocations in the user doc if allocation is set
            alloc = item.get("capital_allocation", 0.0)
            if alloc > 0 and is_enabled() and uid != "default":
                from agent.firestore import get_user
                user_doc = get_user(uid) or {}
                allocations = user_doc.get("strategy_allocations", {})
                allocations[strategy_id] = alloc
                update_user(uid, {"strategy_allocations": allocations})
            activity_log.emit({
                "type": "tool_call",
                "tool": "propose_strategy",
                "summary": f"Strategy created: {doc['name']}",
            })
            # Notify sidebar to reload
            try:
                activity_log.emit({"type": "strategies_updated", "summary": "New strategy created"})
            except Exception:
                pass
            if ok:
                return {"status": "created", "strategy_id": strategy_id, "name": doc["name"]}
            else:
                raise HTTPException(status_code=500, detail=f"Failed to create strategy '{strategy_id}' in Firestore")
        else:
            raise HTTPException(status_code=400, detail=f"Unknown approval type: {item_type}")
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
            save_approvals([])
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


