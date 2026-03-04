"""
Per-user context via Python contextvars.

Before running any agent job or heartbeat for a user, call set_user_ctx()
with a UserContext built from that user's Firestore document.
Tools then call get_user_ctx() to access user-specific state.

Single-user / dev mode: if no context is set, falls back to env vars.
"""
import os
import logging
from contextvars import ContextVar
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_user_ctx: ContextVar["UserContext"] = ContextVar("user_ctx", default=None)

# Local settings override file for single-user / dev mode
_LOCAL_SETTINGS_PATH = Path("memory/default/settings.json")


class UserContext:
    def __init__(self, uid: str, doc: dict):
        self.uid   = uid
        self.email = doc.get("email", "")

        self.autonomous  = doc.get("autonomous", False)
        self.paused      = doc.get("paused", False)
        self.telegram_chat_id = doc.get("telegram_chat_id")

        # ── memory directory (per-user) ────────────────────────────────────
        self.memory_dir = Path(f"memory/{uid}")
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        # ── risk / financial settings ──────────────────────────────────────
        self.strategy_allocations: dict = doc.get("strategy_allocations", {})

        from data.dhan_client import DhanClient
        from risk.guard import RiskGuard

        self.dhan = DhanClient(
            client_id    = doc.get("dhan_client_id"),
            access_token = doc.get("dhan_access_token"),
        )

        seed_capital = doc.get("seed_capital", 10000)
        self.risk = RiskGuard(seed_capital=seed_capital)
        self.risk_by_strategy: dict[str, RiskGuard] = {}
        for strategy_id, sr in doc.get("strategy_risk", {}).items():
            self.risk_by_strategy[strategy_id] = RiskGuard(
                seed_capital=seed_capital,
                max_risk_per_trade_pct=sr.get("max_risk_per_trade_pct", 2.0),
            )


def get_user_ctx() -> UserContext:
    """Return the UserContext for the current execution context."""
    ctx = _user_ctx.get()
    if ctx is not None:
        return ctx
    # Fall back to single-user mode built from env vars
    return _get_default_ctx()


def set_user_ctx(ctx: UserContext):
    """Set the UserContext for the current execution context. Returns the token for reset."""
    return _user_ctx.set(ctx)


def reset_user_ctx(token):
    """Reset to previous context after a job completes."""
    _user_ctx.reset(token)


def _get_default_ctx() -> UserContext:
    """Build a UserContext from env vars, overridden by local settings file if present."""
    import json
    logger.debug("No user context set — using single-user env-var mode")
    base: dict = {
        "dhan_client_id":    os.environ.get("DHAN_CLIENT_ID"),
        "dhan_access_token": os.environ.get("DHAN_ACCESS_TOKEN"),
        "seed_capital":      float(os.environ.get("SEED_CAPITAL", "10000")),

        "autonomous":        os.environ.get("AUTONOMOUS", "false").lower() == "true",
    }
    if _LOCAL_SETTINGS_PATH.exists():
        try:
            overrides = json.loads(_LOCAL_SETTINGS_PATH.read_text())
            base.update(overrides)
        except Exception:
            pass
    return UserContext("default", base)
