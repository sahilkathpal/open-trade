from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated, Optional

from pydantic import BaseModel

from api.auth import get_current_uid
from api.routes.state import _set_user_ctx_for_uid
from agent.user_context import reset_user_ctx

router = APIRouter()


class StrategyUpdate(BaseModel):
    status: Optional[str] = None   # "active" | "paused"


@router.get("/api/strategies")
def get_strategies(uid: Annotated[str, Depends(get_current_uid)]):
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.tools import list_registered_strategies
        return list_registered_strategies()
    finally:
        reset_user_ctx(token)


@router.patch("/api/strategies/{strategy_id}")
def update_strategy(
    strategy_id: str,
    body: StrategyUpdate,
    uid: Annotated[str, Depends(get_current_uid)],
):
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.tools import list_registered_strategies, register_strategy
        strategies = list_registered_strategies()
        existing = next((s for s in strategies if s["id"] == strategy_id), None)
        if not existing:
            raise HTTPException(status_code=404, detail="Strategy not found")
        new_status = body.status or existing.get("status", "active")
        register_strategy(strategy_id, existing["name"], status=new_status)
        return {"status": "ok", "strategy_id": strategy_id, "new_status": new_status}
    finally:
        reset_user_ctx(token)
