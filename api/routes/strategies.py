from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated, Optional

from pydantic import BaseModel

from api.auth import get_current_uid
from api.routes.state import _set_user_ctx_for_uid
from agent.user_context import reset_user_ctx

router = APIRouter()


class StrategyUpdate(BaseModel):
    status: Optional[str] = None   # "active" | "paused"


class VersionLabelUpdate(BaseModel):
    label: str


@router.get("/api/strategies")
def get_strategies(uid: Annotated[str, Depends(get_current_uid)]):
    """List all strategies with P&L summary. Tries Firestore first, falls back to file-backed registry."""
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.firestore_strategies import list_strategies as _fs_list, get_strategy_pnl as _fs_pnl
        strategies = _fs_list(uid)
        if strategies:
            # Enrich with lifetime P&L for sidebar/cards
            for s in strategies:
                try:
                    pnl = _fs_pnl(uid, s["id"])
                    s["total_realized"] = pnl.get("total_realized", 0.0)
                    s["total_trades"] = pnl.get("total_trades", 0)
                except Exception:
                    s.setdefault("total_realized", 0.0)
                    s.setdefault("total_trades", 0)
            return strategies
        # Fallback: file-backed registry (dev mode / pre-migration)
        from agent.tools import list_registered_strategies
        return list_registered_strategies()
    finally:
        reset_user_ctx(token)


@router.get("/api/strategies/{strategy_id}")
def get_strategy(
    strategy_id: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """Get full strategy doc including thesis, rules, learnings."""
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.firestore_strategies import get_strategy as _fs_get
        doc = _fs_get(uid, strategy_id)
        if doc is None:
            raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")
        return doc
    finally:
        reset_user_ctx(token)


@router.patch("/api/strategies/{strategy_id}")
def update_strategy(
    strategy_id: str,
    body: StrategyUpdate,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """Update strategy status (active/paused). Tries Firestore first, falls back to file."""
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        new_status = body.status
        if not new_status:
            raise HTTPException(status_code=400, detail="status is required")

        # Try Firestore
        from agent.firestore_strategies import get_strategy as _fs_get, update_strategy as _fs_update
        doc = _fs_get(uid, strategy_id)
        if doc:
            ok = _fs_update(uid, strategy_id, {"status": new_status})
            if ok:
                return {"status": "ok", "strategy_id": strategy_id, "new_status": new_status}

        # Fallback: file-backed registry
        from agent.tools import list_registered_strategies, register_strategy
        strategies = list_registered_strategies()
        existing = next((s for s in strategies if s["id"] == strategy_id), None)
        if not existing:
            raise HTTPException(status_code=404, detail="Strategy not found")
        register_strategy(strategy_id, existing["name"], status=new_status)
        return {"status": "ok", "strategy_id": strategy_id, "new_status": new_status}
    finally:
        reset_user_ctx(token)


@router.get("/api/strategies/{strategy_id}/trades")
def get_strategy_trades(
    strategy_id: str,
    uid: Annotated[str, Depends(get_current_uid)],
    limit: int = 50,
):
    """List recent trades for a strategy."""
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.firestore_strategies import list_trades
        return list_trades(uid, strategy_id, limit=limit)
    finally:
        reset_user_ctx(token)


@router.get("/api/strategies/{strategy_id}/schedules")
def get_strategy_schedules(
    strategy_id: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """List schedules for a strategy."""
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.firestore_strategies import get_strategy_schedules
        return get_strategy_schedules(uid, strategy_id)
    finally:
        reset_user_ctx(token)


@router.get("/api/strategies/{strategy_id}/versions")
def get_strategy_versions(
    strategy_id: str,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """List version snapshots for a strategy (thesis+rules history)."""
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.firestore_strategies import list_versions
        return list_versions(uid, strategy_id)
    finally:
        reset_user_ctx(token)


@router.patch("/api/strategies/{strategy_id}/versions/{version_id}")
def label_strategy_version(
    strategy_id: str,
    version_id: str,
    body: VersionLabelUpdate,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """Set a human-readable label on a version snapshot."""
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.firestore_strategies import label_version
        ok = label_version(uid, strategy_id, version_id, body.label)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to label version")
        return {"status": "ok", "version_id": version_id, "label": body.label}
    finally:
        reset_user_ctx(token)
