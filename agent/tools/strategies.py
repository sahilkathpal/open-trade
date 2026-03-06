"""
Strategy management tools — Firestore-backed.

Tier 0 (read): get_strategy, list_strategies, get_strategy_pnl
Tier 2 (approval when not autonomous): update_strategy_thesis, update_strategy_rules,
                                        write_schedule (via __init__)
Tier 3 (always approval): propose_strategy, archive_strategy, set_strategy_allocation
"""
import logging
import uuid
from datetime import datetime

import pytz

from agent.user_context import get_user_ctx

_IST = pytz.timezone("Asia/Kolkata")
logger = logging.getLogger(__name__)


# ── Read tools (Tier 0) ────────────────────────────────────────────────────────

def get_strategy(strategy_id: str) -> dict:
    """Fetch a strategy's full config, thesis, rules, and learnings from Firestore."""
    from agent.firestore_strategies import get_strategy as _fs_get
    ctx = get_user_ctx()
    result = _fs_get(ctx.uid, strategy_id)
    if result is None:
        return {"error": f"Strategy '{strategy_id}' not found"}
    return result


def list_strategies() -> list[dict]:
    """List all strategies for the current user. Each entry includes id, name, status, capital_allocation, and P&L summary."""
    from agent.firestore_strategies import list_strategies as _fs_list, get_strategy_pnl as _fs_pnl
    ctx = get_user_ctx()
    strategies = _fs_list(ctx.uid)
    # Enrich with P&L if strategies exist
    for s in strategies:
        try:
            pnl = _fs_pnl(ctx.uid, s["id"])
            s["total_realized"] = pnl.get("total_realized", 0.0)
            s["total_trades"] = pnl.get("total_trades", 0)
        except Exception:
            pass
    return strategies


def get_strategy_pnl(strategy_id: str, period: str = "all") -> dict:
    """Aggregate realized P&L for a strategy from its trades subcollection."""
    from agent.firestore_strategies import get_strategy_pnl as _fs_pnl
    ctx = get_user_ctx()
    return _fs_pnl(ctx.uid, strategy_id)


# ── Write tools (Tier 2) ───────────────────────────────────────────────────────

def update_strategy_thesis(strategy_id: str, thesis: str) -> dict:
    """Update the thesis for a strategy. Requires approval when not autonomous."""
    from agent.firestore_strategies import get_strategy as _fs_get, update_strategy as _fs_update, save_version as _fs_save_version
    ctx = get_user_ctx()
    # Snapshot before update
    existing = _fs_get(ctx.uid, strategy_id)
    if existing:
        _fs_save_version(ctx.uid, strategy_id, existing.get("thesis", ""), existing.get("rules", ""), "thesis")
    ok = _fs_update(ctx.uid, strategy_id, {"thesis": thesis})
    if ok:
        return {"status": "ok", "strategy_id": strategy_id, "field": "thesis"}
    return {"error": f"Failed to update thesis for strategy '{strategy_id}'"}


def update_strategy_rules(strategy_id: str, rules: str) -> dict:
    """Update the trading rules for a strategy. Requires approval when not autonomous."""
    from agent.firestore_strategies import get_strategy as _fs_get, update_strategy as _fs_update, save_version as _fs_save_version
    ctx = get_user_ctx()
    # Snapshot before update
    existing = _fs_get(ctx.uid, strategy_id)
    if existing:
        _fs_save_version(ctx.uid, strategy_id, existing.get("thesis", ""), existing.get("rules", ""), "rules")
    ok = _fs_update(ctx.uid, strategy_id, {"rules": rules})
    if ok:
        return {"status": "ok", "strategy_id": strategy_id, "field": "rules"}
    return {"error": f"Failed to update rules for strategy '{strategy_id}'"}


def update_strategy_learnings(strategy_id: str, observation: str) -> dict:
    """
    Append an observation to the strategy's learnings field in Firestore.
    Auto-allowed (Tier 1) — Claude calls this from EOD jobs.
    """
    from agent.firestore_strategies import get_strategy as _fs_get, update_strategy as _fs_update
    ctx = get_user_ctx()
    existing = _fs_get(ctx.uid, strategy_id)
    if existing is None:
        return {"error": f"Strategy '{strategy_id}' not found"}
    now = datetime.now(_IST).strftime("%Y-%m-%d %H:%M IST")
    prev = existing.get("learnings", "") or ""
    updated = f"{prev}\n\n---\n\n**{now}**\n\n{observation}".strip()
    ok = _fs_update(ctx.uid, strategy_id, {"learnings": updated})
    if ok:
        return {"status": "ok", "strategy_id": strategy_id}
    return {"error": f"Failed to update learnings for strategy '{strategy_id}'"}


# ── Tier 3 tools (always require approval) ────────────────────────────────────

def propose_strategy(
    id: str,
    name: str,
    thesis: str,
    rules: str,
    capital_allocation: float = 0.0,
    risk_config: dict = None,
) -> dict:
    """
    Propose a new strategy. Queues a strategy_proposal approval — does NOT create
    the strategy directly. The approval card is shown inline in the chat.

    On acceptance: api/routes/actions.py calls create_strategy() in Firestore.
    """
    from agent.tools import queue_approval, _append_activity
    ctx = get_user_ctx()

    if not id or not name:
        return {"error": "id and name are required"}
    if not thesis:
        return {"error": "thesis is required"}
    if not rules:
        return {"error": "rules is required"}

    # Expires 24h from now (proposals can span multiple sessions)
    now = datetime.now(_IST)
    expires_iso = now.replace(hour=23, minute=59, second=0, microsecond=0).isoformat()

    payload = {
        "proposal_strategy_id": id,
        "name": name,
        "thesis": thesis,
        "rules": rules,
        "capital_allocation": capital_allocation,
        "risk_config": risk_config or {},
    }
    description = f"New strategy: {name} ({id})"
    approval_id = queue_approval(
        type="strategy_proposal",
        payload=payload,
        expires_at=expires_iso,
        strategy_id=id,
        description=description,
    )

    _append_activity(f"STRATEGY PROPOSED id={id} name={name} (approval_id={approval_id})")

    try:
        from api import activity_log
        activity_log.emit({
            "type": "strategy_proposal",
            "id": approval_id,
            "description": description,
            "summary": f"Strategy proposal: {name}",
            # Include full payload so chat WS can emit strategy_proposal event
            "proposal_strategy_id": id,
            "name": name,
            "thesis": thesis,
            "rules": rules,
            "capital_allocation": capital_allocation,
            "risk_config": risk_config or {},
        })
    except Exception:
        pass

    return {
        "status": "pending_approval",
        "id": approval_id,
        "type": "strategy_proposal",
        "message": f"Strategy '{name}' proposal queued. Awaiting your approval in chat.",
    }


def set_strategy_autonomy(strategy_id: str, mode: str) -> dict:
    """
    Set per-strategy autonomy mode. Always requires approval (Tier 3).
    mode='autonomous': Tier 2 tools (place_trade, exit, thesis/rules updates) run without asking.
    mode='approval': Tier 2 tools ask for approval (default).
    """
    if mode not in ("autonomous", "approval"):
        return {"error": f"Invalid mode '{mode}'. Must be 'autonomous' or 'approval'"}
    from agent.firestore_strategies import update_strategy as _fs_update
    ctx = get_user_ctx()
    ok = _fs_update(ctx.uid, strategy_id, {"autonomy": mode})
    if ok:
        return {"status": "ok", "strategy_id": strategy_id, "autonomy": mode}
    return {"error": f"Failed to update autonomy for strategy '{strategy_id}'"}


def list_strategy_versions(strategy_id: str) -> list[dict]:
    """List version snapshots for a strategy (thesis+rules history). Tier 0."""
    from agent.firestore_strategies import list_versions as _fs_list_versions
    ctx = get_user_ctx()
    return _fs_list_versions(ctx.uid, strategy_id)


def label_strategy_version(strategy_id: str, version_id: str, label: str) -> dict:
    """Set a human label on a strategy version snapshot. Tier 2."""
    from agent.firestore_strategies import label_version as _fs_label_version
    ctx = get_user_ctx()
    ok = _fs_label_version(ctx.uid, strategy_id, version_id, label)
    if ok:
        return {"status": "ok", "strategy_id": strategy_id, "version_id": version_id, "label": label}
    return {"error": f"Failed to label version '{version_id}'"}


def archive_strategy(strategy_id: str) -> dict:
    """Archive a strategy. Always requires approval (Tier 3)."""
    from agent.firestore_strategies import archive_strategy as _fs_archive
    ctx = get_user_ctx()
    ok = _fs_archive(ctx.uid, strategy_id)
    if ok:
        return {"status": "ok", "strategy_id": strategy_id, "new_status": "archived"}
    return {"error": f"Failed to archive strategy '{strategy_id}'"}


def set_strategy_allocation(strategy_id: str, amount: float) -> dict:
    """Set capital allocation for a strategy. Always requires approval (Tier 3)."""
    from agent.firestore import update_user
    ctx = get_user_ctx()
    allocations = dict(ctx.strategy_allocations)
    allocations[strategy_id] = amount
    update_user(ctx.uid, {"strategy_allocations": allocations})
    return {"status": "ok", "strategy_id": strategy_id, "capital_allocation": amount}


# ── Schemas for new strategy tools ────────────────────────────────────────────

STRATEGY_TOOL_SCHEMAS = [
    {
        "name": "get_strategy",
        "description": "Fetch a strategy's full config, thesis, rules, and learnings from Firestore.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string", "description": "Strategy identifier (e.g. 'intraday', 'swing')"},
            },
            "required": ["strategy_id"],
        },
    },
    {
        "name": "list_strategies",
        "description": "List all active strategies for the current user, including name, status, capital allocation, and P&L summary.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_strategy_pnl",
        "description": "Aggregate realized P&L for a strategy from its trade history.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "period": {"type": "string", "enum": ["all", "today", "week", "month"], "default": "all"},
            },
            "required": ["strategy_id"],
        },
    },
    {
        "name": "update_strategy_thesis",
        "description": "Update the investment thesis for a strategy. Requires user approval when not in autonomous mode.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "thesis": {"type": "string", "description": "New thesis text (markdown)"},
            },
            "required": ["strategy_id", "thesis"],
        },
    },
    {
        "name": "update_strategy_rules",
        "description": "Update the trading rules for a strategy. Requires user approval when not in autonomous mode.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "rules": {"type": "string", "description": "New rules text (markdown)"},
            },
            "required": ["strategy_id", "rules"],
        },
    },
    {
        "name": "update_strategy_learnings",
        "description": "Append an observation to a strategy's learnings. Auto-allowed — call from EOD jobs to record what worked and what didn't.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "observation": {"type": "string", "description": "Observation to append"},
            },
            "required": ["strategy_id", "observation"],
        },
    },
    {
        "name": "propose_strategy",
        "description": (
            "Propose a new trading strategy. Shows an inline approval card in chat — "
            "strategy is created only after the user accepts. "
            "Always requires explicit user approval (Tier 3).\n\n"
            "Required fields:\n"
            "  id: short slug (e.g. 'momentum', 'swing')\n"
            "  name: human-readable name\n"
            "  thesis: investment thesis (markdown, 2-5 sentences)\n"
            "  rules: entry/exit/sizing/risk rules (markdown)\n"
            "  capital_allocation: INR amount to allocate\n"
            "  risk_config: {max_risk_per_trade_pct, max_open_positions}\n\n"
            "Always discuss and agree on the strategy with the user in chat before calling this tool."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "Short slug, e.g. 'momentum', 'swing'"},
                "name": {"type": "string", "description": "Human-readable name, e.g. 'Intraday Momentum'"},
                "thesis": {"type": "string", "description": "Investment thesis (markdown)"},
                "rules": {"type": "string", "description": "Trading rules — entry criteria, exit conditions, sizing, risk limits (markdown)"},
                "capital_allocation": {"type": "number", "description": "INR amount to allocate to this strategy", "default": 0},
                "risk_config": {
                    "type": "object",
                    "description": "Per-strategy risk config",
                    "properties": {
                        "max_risk_per_trade_pct": {"type": "number", "description": "Max % of allocation risked per trade", "default": 2.0},
                        "max_open_positions": {"type": "integer", "description": "Max simultaneous open positions", "default": 2},
                    },
                },
            },
            "required": ["id", "name", "thesis", "rules"],
        },
    },
    {
        "name": "archive_strategy",
        "description": "Archive a strategy. This stops all jobs and prevents new trades. Always requires user approval.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
            },
            "required": ["strategy_id"],
        },
    },
    {
        "name": "set_strategy_allocation",
        "description": "Set the capital allocation for a strategy. Always requires user approval.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "amount": {"type": "number", "description": "INR amount to allocate"},
            },
            "required": ["strategy_id", "amount"],
        },
    },
    {
        "name": "set_strategy_autonomy",
        "description": (
            "Set per-strategy autonomy mode. Always requires user approval (Tier 3).\n"
            "mode='autonomous': place_trade, exit_position, update_thesis/rules run without asking.\n"
            "mode='approval': all Tier 2 tools ask for user approval (default)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "mode": {"type": "string", "enum": ["autonomous", "approval"], "description": "'autonomous' or 'approval'"},
            },
            "required": ["strategy_id", "mode"],
        },
    },
    {
        "name": "list_strategy_versions",
        "description": "List version snapshots for a strategy (thesis+rules change history), most recent first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
            },
            "required": ["strategy_id"],
        },
    },
    {
        "name": "label_strategy_version",
        "description": "Set a human-readable label on a strategy version snapshot (e.g. 'v1.0 - original').",
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string"},
                "version_id": {"type": "string"},
                "label": {"type": "string", "description": "Label to apply, e.g. 'v1.0 - original'"},
            },
            "required": ["strategy_id", "version_id", "label"],
        },
    },
]

STRATEGY_TOOL_FUNCTIONS = {
    "get_strategy":               get_strategy,
    "list_strategies":            list_strategies,
    "get_strategy_pnl":           get_strategy_pnl,
    "update_strategy_thesis":     update_strategy_thesis,
    "update_strategy_rules":      update_strategy_rules,
    "update_strategy_learnings":  update_strategy_learnings,
    "propose_strategy":           propose_strategy,
    "archive_strategy":           archive_strategy,
    "set_strategy_allocation":    set_strategy_allocation,
    "set_strategy_autonomy":      set_strategy_autonomy,
    "list_strategy_versions":     list_strategy_versions,
    "label_strategy_version":     label_strategy_version,
}
