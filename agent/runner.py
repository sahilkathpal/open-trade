import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Callable, Iterator

import anthropic
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

from agent.tools import ALL_TOOL_SCHEMAS, execute_tool
from agent.permissions import needs_approval
from api import activity_log
from api.token_usage import record as record_tokens

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL = "claude-sonnet-4-6"

# ── Prompts for system-level job types ────────────────────────────────────────
# Only trigger and catchup are system-owned. All scheduled jobs (premarket,
# execution, EOD, or anything else) use Claude-authored prompts stored in
# SCHEDULE.json — job_type="custom" with a prompt field Claude writes during
# the strategy setup conversation.
PROMPTS = {
    "trigger": """A monitoring trigger you set earlier has just fired. Current time: {current_time} IST.
The specific condition and your original note are below (appended after this prompt).

Review the situation with fresh data and make a decision. Steps:
1. Call read_memory() to load your strategy rules document (e.g. STRATEGY_INTRADAY.md).
2. Call get_market_quote() for any symbols in the trigger.
3. Call get_positions() and get_funds() to confirm current exposure and P&L.
4. Call get_historical_data() if candle structure or indicators are relevant.
5. Decide and act — exactly one of:
   - exit_position(): setup has broken down, exit before stop is hit
   - place_trade(): entry trigger, conditions confirmed
   - write_trigger(type="price_in_range", mode="hard", action="place_trade", ...): entry close but conditions not yet met
   - write_trigger(): set a tighter follow-up trigger after reviewing
   - No action: after looking at the data, no action is warranted — note why

Constraints:
- Do not chase — if the move already happened before you reviewed, note it and pass.
- Be brief. Most trigger reviews resolve in 3-4 tool calls.""",

    "catchup": """You are joining the market session late — the current time is {current_time} IST.
Your scheduled jobs did not run for this account today. Do a combined screening and
execution pass using the intraday data already available.

1. Call read_memory() to load your strategy rules document (e.g. STRATEGY_INTRADAY.md).
2. Fetch markets and economy news (categories: markets, economy). Assess today's macro sentiment.
3. Screen for candidates using your strategy's criteria. Multiple candles have already printed —
   use them to confirm or invalidate any thesis.
4. For each candidate, get_market_quote() for the current price:
   - Entry makes sense (not chasing, meets your R:R rules): call place_trade().
   - Close but conditions not met: write_trigger(type="price_in_range", mode="hard", action="place_trade", ...) with entry range, SL, target.
   - Move already happened or thesis broken: skip it, note why.
5. Set monitoring triggers with write_trigger() for any placed/watched positions.
   Always set expires_at to today at 15:00 IST.

Time is limited — be selective. Zero trades is the right answer if nothing is good.""",
}


def _extract_text(response: anthropic.types.Message) -> str:
    """Extract plain text from a Claude response."""
    parts = []
    for block in response.content:
        if hasattr(block, "text"):
            parts.append(block.text)
    return "\n".join(parts)


def _summarise_tool_result(tool: str, inputs: dict, result) -> str:
    """Produce a short summary of a tool call for the activity feed."""
    sym = inputs.get("symbol", "")
    if tool == "get_historical_data" and isinstance(result, dict):
        ind = result.get("indicators", {})
        rsi = ind.get("RSI_14", "")
        close = result.get("latest_close", "")
        return f"{sym} | close ₹{close} RSI {rsi}"
    if tool == "get_market_quote" and isinstance(result, dict):
        syms = inputs.get("symbols", [])
        return f"Quote: {', '.join(syms)}"
    if tool == "fetch_news" and isinstance(result, list):
        return f"{len(result)} articles fetched"
    if tool == "get_fundamentals" and isinstance(result, dict):
        pe = result.get("pe_ratio", "")
        return f"{sym} | PE {pe}"
    if tool == "get_funds" and isinstance(result, dict):
        bal = result.get("available_balance", "")
        return f"Balance ₹{bal}"
    if tool == "get_positions" and isinstance(result, list):
        return f"{len(result)} open positions"
    if tool in ("read_memory", "write_memory"):
        fname = inputs.get("filename", "")
        return fname
    if tool == "place_trade":
        sym = inputs.get("symbol", "")
        if isinstance(result, dict) and result.get("status") == "pending_approval":
            activity_log.emit({"type": "proposal", "symbol": sym, "summary": f"Proposal: {sym}"})
        return f"place_trade {sym} → {result.get('status','') if isinstance(result, dict) else ''}"
    return str(result)[:60] if result else ""


def run(job_type: str, extra_prompt: str = "", strategy_id: str = "") -> str:
    """
    Run the agent for a given job type.

    job_type: 'premarket' | 'heartbeat' | 'eod'
    extra_prompt: additional context to append to the base prompt

    Returns the final text response from the agent.
    """
    if job_type not in PROMPTS and job_type != "custom":
        raise ValueError(f"Unknown job_type: {job_type}. Must be 'custom' or one of {list(PROMPTS.keys())}")

    if job_type == "custom" and not extra_prompt:
        return "Error: custom job requires a prompt. Set one via write_schedule()."

    activity_log.emit({"type": "job_start", "summary": f"{job_type} started"})

    # Build system prompt from SOUL.md + strategy context (Firestore or file fallback)
    # SOUL.md is shared; per-user data lives in Firestore or memory_dir
    soul_path = Path("memory/SOUL.md")
    soul = soul_path.read_text() if soul_path.exists() else "You are an autonomous trading agent."

    from agent.user_context import get_user_ctx
    ctx = get_user_ctx()
    mem = ctx.memory_dir

    # Load strategy-specific context. Try Firestore first, fall back to STRATEGY_{ID}.md.
    memory_parts = []
    if strategy_id:
        try:
            from agent.firestore_strategies import get_strategy as _fs_get_strategy
            strat_doc = _fs_get_strategy(ctx.uid, strategy_id)
            if strat_doc:
                parts = []
                if strat_doc.get("thesis"):
                    parts.append(f"## Thesis\n\n{strat_doc['thesis']}")
                if strat_doc.get("rules"):
                    parts.append(f"## Rules\n\n{strat_doc['rules']}")
                if strat_doc.get("learnings"):
                    parts.append(f"## Learnings\n\n{strat_doc['learnings']}")
                if parts:
                    header = f"# Strategy: {strat_doc.get('name', strategy_id)}"
                    memory_parts.append(header + "\n\n" + "\n\n".join(parts))
        except Exception:
            pass
        # Fallback: file-backed strategy doc
        if not memory_parts:
            specific_path = mem / f"STRATEGY_{strategy_id.upper()}.md"
            if specific_path.exists():
                memory_parts.append(f"## STRATEGY_{strategy_id.upper()}.md\n\n{specific_path.read_text()}")

    memory_context = "\n\n---\n\n".join(memory_parts)
    system = f"{soul}\n\n---\n\n{memory_context}" if memory_context else soul

    # Initial user message
    import pytz as _pytz
    _now = __import__("datetime").datetime.now(_pytz.timezone("Asia/Kolkata"))
    if job_type == "custom":
        user_content = extra_prompt
    else:
        user_content = PROMPTS[job_type].replace("{current_time}", _now.strftime("%I:%M %p"))
        if extra_prompt:
            user_content += f"\n\n{extra_prompt}"

    messages = [{"role": "user", "content": user_content}]

    # Agentic loop
    max_iterations = 20  # safety guard against infinite loops
    iteration = 0

    while iteration < max_iterations:
        iteration += 1
        for attempt in range(4):
            try:
                response = client.messages.create(
                    model=MODEL,
                    system=system,
                    messages=messages,
                    tools=ALL_TOOL_SCHEMAS,
                    max_tokens=4096,
                )
                # Track token usage
                if hasattr(response, "usage") and response.usage:
                    record_tokens(
                        response.usage.input_tokens,
                        response.usage.output_tokens,
                        job_type,
                    )
                break
            except (anthropic.RateLimitError, anthropic.InternalServerError):
                if attempt == 3:
                    raise
                wait = 15 * (attempt + 1)
                logger.warning("API transient error, retrying in %ds...", wait)
                time.sleep(wait)

        if response.stop_reason == "end_turn":
            activity_log.emit({"type": "job_end", "summary": f"{job_type} complete"})
            return _extract_text(response)

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = execute_tool(block.name, block.input)
                    # Emit activity event for the web UI feed
                    summary = _summarise_tool_result(block.name, block.input, result)
                    activity_log.emit({"type": "tool_call", "tool": block.name, "summary": summary})
                    tool_results.append({
                        "type":        "tool_result",
                        "tool_use_id": block.id,
                        "content":     json.dumps(result, default=str),
                    })

            # Append assistant's response and tool results to the conversation
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user",      "content": tool_results})

        else:
            # Unexpected stop reason — return what we have
            return _extract_text(response) or f"Stopped with reason: {response.stop_reason}"

    activity_log.emit({"type": "job_end", "summary": f"{job_type} max iterations reached"})
    return "Max iterations reached. Agent loop terminated."


def run_chat_stream(
    message: str,
    history: list[dict],
    strategy: str = "intraday",
    status_context: str = "",
    permission_callback: Callable[[str, str, dict], bool] | None = None,
) -> Iterator[dict]:
    """
    Streaming chat agent loop.

    Yields:
        {"type": "token", "content": str}
        {"type": "tool_call", "tool": str, "summary": str}
        {"type": "done"}
    """
    soul_path = Path("memory/SOUL.md")
    soul = soul_path.read_text() if soul_path.exists() else "You are an autonomous trading agent."

    # Interface guide — what controls exist in the UI and what Claude can do from chat.
    # Update this block when the UI changes (same commit as the UI code change).
    interface_guide = """\
## App Interface

The user is talking to you through the open-trade web app. Here's what exists:

**Strategy page tabs**
- Chat — this conversation
- Trades — live position table (entry, quantity, stop loss, P&L)
- Agent — activity feed of recent tool calls and job runs; token usage chart
- Documents — strategy memory files displayed read-only

**Sidebar**
- Strategy list (all registered strategies appear here)
- Thread list per strategy — each chat session is a separate thread
- "New chat" button creates a fresh thread

**Guardrails panel** (accessible from the strategy page header)
- Seed capital (portfolio-level); capital allocation + max risk per trade % (per strategy)
- These are enforced in code — place_trade() is rejected if any limit is breached
- The agent cannot override these limits or request changes to them

**Agent controls** (top-right of strategy page)
- Pause / Resume toggle — stops scheduled jobs when paused
- Autonomous mode toggle — when off, place_trade() requires manual approval

**Settings page**
- Broker credentials (Dhan client ID + access token)
- Telegram bot connection (deep link)

**Telegram bot** (once connected via Settings)
- /status — pending trade proposals
- /positions — open positions with P&L
- /funds — account balance
- /triggers — active monitoring triggers
- /pause and /resume — pause or resume autonomous trading
- /run premarket|execution|eod — manually trigger a scheduled job
- /exit SYMBOL — emergency exit a position
- approve SYMBOL / deny SYMBOL — approve or reject a pending trade proposal
- /start [code] — initial setup or reconnect via deep link

**What Claude can do from this chat**
- Answer questions about positions, P&L, market data, fundamentals
- Read memory files (JOURNAL.md, LEARNINGS.md, etc.) via read_memory
- Place trades, exit positions (subject to RiskGuard limits and autonomous mode)
- Run screens, fetch news, get quotes on any NSE EQ symbol
- Create and manage recurring scheduled jobs (write_schedule, remove_schedule, list_schedules)
- Create and update strategies via propose_strategy, update_strategy_thesis, update_strategy_rules

**Strategy fields — keep strictly separated**
- thesis: the investment hypothesis (why this edge exists)
- rules: trading logic only — entry criteria, exit conditions, position sizing, risk limits, product
  type (MIS/INTRA for intraday, CNC for overnight). Never include schedule or timing information here.
- learnings: post-trade observations (append via update_strategy_learnings)
- schedules: entirely separate — created with write_schedule(), never part of rules

**Strategy creation is not complete until schedules are set up**
A strategy with thesis+rules but no schedule will never run. In the same conversation where a
strategy is created or rules are first established, always finish by calling write_schedule() for
each recurring job (e.g. premarket scan, execution window, EOD review). Propose the schedule to
the user and agree on the cron timing before calling the tool.

**What Claude cannot do from chat**
- Change Guardrails settings (user must use the Guardrails panel)
- Connect/disconnect the Telegram bot
- Update Dhan credentials
- Force-run a scheduled job immediately — jobs run on their cron, not on demand from chat\
"""

    # Build system: identity + interface guide + live state
    system_parts = [soul, interface_guide]
    if status_context:
        system_parts.append(f"## Current State\n\n{status_context}")
    system = "\n\n---\n\n".join(system_parts)

    messages = list(history)
    messages.append({"role": "user", "content": message})

    max_iterations = 10
    iteration = 0

    while iteration < max_iterations:
        iteration += 1

        with client.messages.stream(
            model=MODEL,
            system=system,
            messages=messages,
            tools=ALL_TOOL_SCHEMAS,
            max_tokens=4096,
        ) as stream:
            for text in stream.text_stream:
                yield {"type": "token", "content": text}
            response = stream.get_final_message()

        if hasattr(response, "usage") and response.usage:
            record_tokens(response.usage.input_tokens, response.usage.output_tokens, "chat")

        if response.stop_reason == "end_turn":
            yield {"type": "done"}
            return

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    from agent.user_context import get_user_ctx
                    autonomous = get_user_ctx().autonomous

                    # Check if this tool needs user permission
                    if permission_callback and needs_approval(block.name, block.input, autonomous, strategy_id=strategy):
                        request_id = str(uuid.uuid4())
                        # strategy_proposal gets its own event type for inline card
                        event_type = "strategy_proposal" if block.name == "propose_strategy" else "permission_request"
                        yield {
                            "type": event_type,
                            "id": request_id,
                            "tool": block.name,
                            "inputs": block.input,
                        }
                        approved = permission_callback(request_id, block.name, block.input)
                        if not approved:
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": json.dumps({
                                    "status": "rejected",
                                    "message": (
                                        "User explicitly rejected this action. "
                                        "Do NOT retry it or include the same change in a subsequent call. "
                                        f"Rejected tool: {block.name}. "
                                        f"Rejected inputs: {json.dumps(block.input, default=str)}"
                                    ),
                                }),
                            })
                            continue

                    result = execute_tool(block.name, block.input)
                    summary = _summarise_tool_result(block.name, block.input, result)
                    yield {"type": "tool_call", "tool": block.name, "summary": summary}
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, default=str),
                    })
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        else:
            yield {"type": "done"}
            return

    yield {"type": "done"}
