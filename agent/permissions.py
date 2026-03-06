"""
Unified, tiered permission system for the trading agent.

Tier 0 — read-only, always allowed
Tier 1 — write, auto-allowed (journal, triggers, learnings, non-structural memory)
Tier 2 — require approval when not autonomous
Tier 3 — always require approval, even in autonomous mode

This is the single source of truth for permission decisions.
Runner's _needs_permission() delegates here; no tool implements its own approval gate
(except place_trade which also handles its own approval queue for batch-job flows).
"""
import re

# ── Tier 0: always allowed (read-only + market data) ─────────────────────────

TIER_0 = frozenset({
    "get_market_quote",
    "get_historical_data",
    "get_fundamentals",
    "fetch_news",
    "get_positions",
    "get_funds",
    "get_index_quote",
    "check_market_holiday",
    "get_strategy",
    "list_strategies",
    "get_strategy_pnl",
    "list_strategy_versions",
    "list_triggers",
    "list_schedules",
    "read_memory",
    "list_registered_strategies",
})

# ── Tier 1: auto-allowed writes ───────────────────────────────────────────────

TIER_1 = frozenset({
    "append_journal",
    "remove_trigger",
    "update_strategy_learnings",
    # write_memory: gated per-call based on filename (see _is_structural_memory)
    # write_trigger: gated per-call based on mode (see needs_approval)
})

# ── Tier 2: require approval when not autonomous ──────────────────────────────

TIER_2 = frozenset({
    "place_trade",
    "exit_position",
    "update_strategy_thesis",
    "update_strategy_rules",
    "label_strategy_version",
    "write_schedule",
    "remove_schedule",
})

# ── Tier 3: always require approval (even in autonomous mode) ─────────────────

TIER_3 = frozenset({
    "propose_strategy",
    "archive_strategy",
    "set_strategy_allocation",
    "set_strategy_autonomy",
})


def _is_structural_memory(inputs: dict) -> bool:
    """Return True if write_memory targets a structural strategy rules file.
    Structural = STRATEGY_{ID}.md (exactly two segments, not STRATEGY_X_LEARNINGS.md)."""
    filename = inputs.get("filename", "")
    return bool(re.match(r"^STRATEGY_[A-Z0-9]+\.md$", filename))


def needs_approval(tool_name: str, inputs: dict, autonomous: bool, strategy_id: str = "") -> bool:
    """
    Return True if this tool call requires user approval before execution.

    - Tier 0: never
    - Tier 1: never (auto-allowed writes)
    - Tier 2: when not autonomous (per-strategy autonomy checked first, falls back to global flag)
    - Tier 3: always

    Special cases:
    - write_memory(STRATEGY_{ID}.md): Tier 2 — requires approval when not autonomous
    - write_trigger(mode="hard"): Tier 2 — requires approval when not autonomous
    """
    if tool_name in TIER_0:
        return False

    if tool_name in TIER_3:
        return True

    # Tier 2: check per-strategy autonomy, fall back to global flag
    if tool_name in TIER_2:
        if strategy_id:
            try:
                from agent.firestore_strategies import get_strategy
                from agent.user_context import get_user_ctx
                s = get_strategy(get_user_ctx().uid, strategy_id)
                if s and s.get("autonomy") == "autonomous":
                    return False
            except Exception:
                pass
        return not autonomous

    if tool_name == "write_memory" and _is_structural_memory(inputs):
        if strategy_id:
            try:
                from agent.firestore_strategies import get_strategy
                from agent.user_context import get_user_ctx
                s = get_strategy(get_user_ctx().uid, strategy_id)
                if s and s.get("autonomy") == "autonomous":
                    return False
            except Exception:
                pass
        return not autonomous

    if tool_name == "write_trigger" and inputs.get("mode") == "hard":
        if strategy_id:
            try:
                from agent.firestore_strategies import get_strategy
                from agent.user_context import get_user_ctx
                s = get_strategy(get_user_ctx().uid, strategy_id)
                if s and s.get("autonomy") == "autonomous":
                    return False
            except Exception:
                pass
        return not autonomous

    # write_schedule is explicitly Tier 2 (covered above)
    # Everything else (Tier 0/1 tools not listed) is auto-allowed
    return False
