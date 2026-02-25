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


class SettingsIn(BaseModel):
    dhan_client_id:      Optional[str]   = None
    dhan_access_token:   Optional[str]   = None
    seed_capital:        Optional[float] = None
    daily_loss_limit:    Optional[float] = None
    max_open_positions:  Optional[int]   = None  # stored as max_positions in Firestore
    profit_lock_pct:     Optional[float] = None
    autonomous:          Optional[bool]  = None
    # Telegram disconnect
    telegram_connected:  Optional[bool]  = None
    telegram_username:   Optional[str]   = None


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
            "daily_loss_limit":      abs(local.get("daily_loss_limit", 500.0)),
            "max_open_positions":    local.get("max_positions",      2),
            "profit_lock_pct":       local.get("profit_lock_pct",    4.0),
            "autonomous":            local.get("autonomous",         os.getenv("AUTONOMOUS", "false").lower() == "true"),
            "telegram_connected":    bool(local.get("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID"))),
            "telegram_username":     "",
        }

    doc = get_user(uid) or {}

    return {
        "dhan_client_id":       doc.get("dhan_client_id", ""),
        "dhan_access_token_set": bool(doc.get("dhan_access_token")),
        "seed_capital":          doc.get("seed_capital", 10000.0),
        "daily_loss_limit":      abs(doc.get("daily_loss_limit", 500.0)),
        "max_open_positions":    doc.get("max_positions", 2),
        "profit_lock_pct":       doc.get("profit_lock_pct", 4.0),
        "autonomous":            doc.get("autonomous", False),
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
        if raw.get("daily_loss_limit") is not None:
            local["daily_loss_limit"] = abs(raw["daily_loss_limit"])
        if raw.get("max_open_positions") is not None:
            local["max_positions"] = raw["max_open_positions"]
        if raw.get("profit_lock_pct") is not None:
            local["profit_lock_pct"] = raw["profit_lock_pct"]
        if raw.get("autonomous") is not None:
            local["autonomous"] = raw["autonomous"]
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
    if raw.get("daily_loss_limit") is not None:
        # Store as positive; UserContext will negate it
        data["daily_loss_limit"] = abs(raw["daily_loss_limit"])
    if raw.get("max_open_positions") is not None:
        data["max_positions"] = raw["max_open_positions"]
    if raw.get("profit_lock_pct") is not None:
        data["profit_lock_pct"] = raw["profit_lock_pct"]
    if raw.get("autonomous") is not None:
        data["autonomous"] = raw["autonomous"]
    # Telegram disconnect
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
