"""
User settings API — broker credentials, risk config, autonomous flag, Telegram connection.
Requires Firebase auth.
"""
import json
import secrets
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import get_current_uid

router = APIRouter()

_LOCAL_SETTINGS_PATH = Path("memory/default/settings.json")


def _load_local_settings() -> dict:
    if _LOCAL_SETTINGS_PATH.exists():
        try:
            return json.loads(_LOCAL_SETTINGS_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_local_settings(updates: dict):
    _LOCAL_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = _load_local_settings()
    existing.update(updates)
    _LOCAL_SETTINGS_PATH.write_text(json.dumps(existing, indent=2))


class StrategyRisk(BaseModel):
    max_risk_per_trade_pct: Optional[float] = None  # % of strategy allocation


class SettingsIn(BaseModel):
    dhan_client_id:        Optional[str]             = None
    dhan_access_token:     Optional[str]             = None
    seed_capital:          Optional[float]           = None
    autonomous:            Optional[bool]            = None
    strategy_allocations:  Optional[dict]            = None  # {"intraday": 60000}
    strategy_risk:         Optional[dict[str, StrategyRisk]] = None  # {"intraday": {...}}
    # Telegram disconnect
    telegram_connected:    Optional[bool]            = None
    telegram_username:     Optional[str]             = None


@router.get("/api/settings")
def get_settings(uid: Annotated[str, Depends(get_current_uid)]):
    """Return the current user's settings (access token is write-only)."""
    from agent.firestore import is_enabled, get_user
    import os

    if not is_enabled() or uid == "default":
        local = _load_local_settings()
        return {
            "dhan_client_id":        local.get("dhan_client_id",    os.getenv("DHAN_CLIENT_ID", "")),
            "dhan_access_token_set": bool(local.get("dhan_access_token", os.getenv("DHAN_ACCESS_TOKEN"))),
            "seed_capital":          local.get("seed_capital",       float(os.getenv("SEED_CAPITAL", "10000"))),
            "autonomous":            local.get("autonomous",         os.getenv("AUTONOMOUS", "false").lower() == "true"),
            "strategy_allocations":  local.get("strategy_allocations", {}),
            "strategy_risk":         local.get("strategy_risk", {}),
            "telegram_connected":    bool(local.get("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID"))),
            "telegram_username":     "",
        }

    doc = get_user(uid) or {}

    return {
        "dhan_client_id":        doc.get("dhan_client_id", ""),
        "dhan_access_token_set": bool(doc.get("dhan_access_token")),
        "seed_capital":          doc.get("seed_capital", 10000.0),
        "autonomous":            doc.get("autonomous", False),
        "strategy_allocations":  doc.get("strategy_allocations", {}),
        "strategy_risk":         doc.get("strategy_risk", {}),
        "telegram_connected":    bool(doc.get("telegram_chat_id")),
        "telegram_username":     "",  # not stored — Telegram handles display name
        "email":                 doc.get("email", ""),
    }


@router.put("/api/settings")
def update_settings(
    body: SettingsIn,
    uid: Annotated[str, Depends(get_current_uid)],
):
    """Update user settings in Firestore."""
    from agent.firestore import is_enabled, update_user

    if not is_enabled() or uid == "default":
        raw = body.model_dump()
        local: dict = {}
        if raw.get("dhan_client_id") is not None:
            local["dhan_client_id"] = raw["dhan_client_id"]
        if raw.get("dhan_access_token") is not None:
            local["dhan_access_token"] = raw["dhan_access_token"]
        if raw.get("seed_capital") is not None:
            local["seed_capital"] = raw["seed_capital"]
        if raw.get("autonomous") is not None:
            local["autonomous"] = raw["autonomous"]
        if raw.get("strategy_allocations") is not None:
            # Deep-merge — don't overwrite other strategies' allocations
            existing_allocs = _load_local_settings().get("strategy_allocations", {})
            existing_allocs.update(raw["strategy_allocations"])
            local["strategy_allocations"] = existing_allocs
        if raw.get("strategy_risk") is not None:
            # Deep-merge per-strategy risk into existing strategy_risk
            existing_risk = _load_local_settings().get("strategy_risk", {})
            for sid, risk in raw["strategy_risk"].items():
                existing_risk.setdefault(sid, {}).update(
                    {k: v for k, v in risk.items() if v is not None}
                )
            local["strategy_risk"] = existing_risk
        if raw.get("telegram_connected") is False:
            local["telegram_chat_id"] = None
        if local:
            _save_local_settings(local)
        return {"status": "ok", "updated": list(local.keys())}

    raw = body.model_dump()
    data: dict = {}

    # Map frontend field names → Firestore field names
    if raw.get("dhan_client_id") is not None:
        data["dhan_client_id"] = raw["dhan_client_id"]
    if raw.get("dhan_access_token") is not None:
        data["dhan_access_token"] = raw["dhan_access_token"]
    if raw.get("seed_capital") is not None:
        data["seed_capital"] = raw["seed_capital"]
    if raw.get("autonomous") is not None:
        data["autonomous"] = raw["autonomous"]
    if raw.get("strategy_allocations") is not None:
        # Use dot-notation keys so Firestore merges at the strategy level,
        # not overwrite the entire map (which would wipe other strategies)
        for sid, amount in raw["strategy_allocations"].items():
            data[f"strategy_allocations.{sid}"] = amount
    if raw.get("strategy_risk") is not None:
        for sid, risk in raw["strategy_risk"].items():
            for field, value in risk.items():
                if value is not None:
                    data[f"strategy_risk.{sid}.{field}"] = value
    if raw.get("telegram_connected") is False:
        data["telegram_chat_id"] = None

    if not data:
        return {"status": "ok"}

    update_user(uid, data)
    return {"status": "ok", "updated": list(data.keys())}


@router.post("/api/telegram/connect")
def telegram_connect(uid: Annotated[str, Depends(get_current_uid)]):
    """
    Generate a one-time deep link for connecting this account to Telegram.
    Returns a t.me link and expiry countdown (15 minutes = 900 seconds).
    """
    import os
    from agent.firestore import is_enabled, set_telegram_pending

    bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "")
    if not bot_username:
        raise HTTPException(status_code=500, detail="TELEGRAM_BOT_USERNAME not configured")

    if not is_enabled():
        raise HTTPException(status_code=400, detail="Telegram deep link requires Firebase")

    code = secrets.token_urlsafe(16)
    set_telegram_pending(code, uid)

    return {
        "deep_link":        f"https://t.me/{bot_username}?start={code}",
        "expires_in_seconds": 900,
    }
