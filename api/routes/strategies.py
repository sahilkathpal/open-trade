from fastapi import APIRouter, Depends
from typing import Annotated

from api.auth import get_current_uid
from api.routes.state import _set_user_ctx_for_uid
from agent.user_context import reset_user_ctx

router = APIRouter()


@router.get("/api/strategies")
def get_strategies(uid: Annotated[str, Depends(get_current_uid)]):
    token, _ctx = _set_user_ctx_for_uid(uid)
    try:
        from agent.tools import list_registered_strategies
        return list_registered_strategies()
    finally:
        reset_user_ctx(token)
