import json
import logging
import os
import time
from pathlib import Path

import anthropic
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

from agent.tools import ALL_TOOL_SCHEMAS, execute_tool
from api import activity_log
from api.token_usage import record as record_tokens

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL = "claude-sonnet-4-6"

# ── Prompts for each job type ──────────────────────────────────────────────────
PROMPTS = {
    "premarket": """Good morning. It's pre-market screening time (8:45 AM).

Your job right now is SCREENING ONLY — not entry planning. Entry levels will be set at 9:35 AM
after the first candle closes with real data.

1. Read STRATEGY.md to recall your working hypothesis and recent learnings.
2. Fetch markets and economy news (categories: markets, economy). Assess macro sentiment and
   which sectors face headwinds vs tailwinds today.
3. Screen for 2-3 candidate stocks to watch today:
   - Fundamental quality filter: check get_fundamentals() for P/E, margins, ROE, revenue growth.
     Prefer stocks with PE < 25, margins > 15%, positive revenue growth.
   - Thesis: why is this stock interesting TODAY given today's news and macro?
   - Check daily chart only: get_historical_data(symbol, interval="D", days=60) for trend direction.
   - Do NOT set entry prices, stop losses, or targets yet. Those come at 9:35 AM with live data.
4. Rewrite MARKET.md with:
   - Today's date and macro/sector context
   - Each candidate marked WATCH with thesis only (no entry levels)
   - A "Setup to verify at open" note per candidate (e.g. "confirm first candle closes bullish with volume")

Do NOT call place_trade. Do NOT call get_historical_data with intraday intervals.
Entry decisions happen at 9:35 AM when the first candle has closed.""",

    "execution": """It is 9:35 AM. The first 15-minute candle (9:15–9:30 AM) has just closed.
This is the execution planning job — set real entry levels using today's live data.

1. Read MARKET.md to get today's WATCH candidates and their pre-market thesis.
2. For each WATCH candidate:
   a. Call get_market_quote() to get current price and today's open.
   b. Call get_historical_data(symbol, interval="15", days=2) to see the first completed candle.
   c. Evaluate the first candle:
      - Did it close bullish (close > open)?
      - Was volume above average (check avg_volume vs first candle volume)?
      - Is the current price at a reasonable entry (not gapped >1.5% past a logical level)?
   d. If the setup is valid and price is at entry now:
      - Set entry price: current price or a tight limit (not chasing a gap).
      - Set stop loss: below first candle low, or below VWAP — must be 1.5–2.5% below entry.
      - Set target: minimum 2R from entry.
      - Call place_trade() to propose the trade.
   e. If the setup has potential but entry conditions aren't met yet (RSI overbought, price
      hasn't pulled back to support, waiting for breakout confirmation):
      - Call add_to_watchlist() with the exact entry range, stop loss, target, quantity,
        and any technical conditions (rsi_max, candle_close_above).
      - The heartbeat will monitor and trigger place_trade() automatically when conditions are met.
      - Mark candidate as WATCH in MARKET.md with the entry range noted.
   f. If the setup is invalid (weak candle, low volume, gapped too far, thesis broken):
      - Note reason and mark candidate INVALIDATED in MARKET.md.
3. Update MARKET.md to reflect outcomes (PLACED / WATCHING / INVALIDATED) and actual entry parameters.

Be honest. If the first candle doesn't confirm an immediate entry, use add_to_watchlist() rather
than forcing a trade — there will be other opportunities in the session.

Before finishing, set monitoring triggers with write_trigger() for the rest of the session.
For every placed or watched position, consider:
- near_stop: buffer_pct 0.5 — review before the hard stop is hit
- near_target: buffer_pct 0.5 — review whether to trail or exit at target
- index_below: if Nifty breaking a support level would invalidate your thesis, set it
- time: only if there is a specific mid-session setup worth checking at a particular time
  (e.g. "ORB follow-through likely at 10:30" or "second leg after consolidation at 12:00")
  — do NOT set time triggers just to have activity. If today looks quiet, set none.
Always set expires_at to today at 15:00 IST.""",

    "trigger": """A monitoring trigger you set earlier has just fired.
The specific condition and your original note are below (appended after this prompt).

Review the situation with fresh data and make a decision. Steps:
1. Call get_market_quote() for any symbols in the trigger.
2. Call get_positions() and get_funds() to confirm current exposure and P&L.
3. Call get_historical_data() if candle structure or indicators are relevant.
4. Decide and act — exactly one of:
   - exit_position(): setup has broken down, exit before stop is hit
   - place_trade(): entry trigger, conditions confirmed
   - add_to_watchlist(): entry close but not quite there yet
   - write_trigger(): set a tighter follow-up trigger after reviewing
   - No action: after looking at the data, no action is warranted — note why
5. Update MARKET.md with what you found and decided (1-2 lines is enough).

Constraints:
- Do not open new positions if 2 are already open or day P&L ≤ -₹400.
- Do not chase — if the move already happened before you reviewed, note it and pass.
- Be brief. Most trigger reviews resolve in 3-4 tool calls.""",

    "eod": """End of day review. Please:

1. Read MARKET.md (today's canvas) and JOURNAL.md (trade history).
2. Call get_positions() to confirm all positions are closed (MIS auto-squared off).
3. Call get_funds() to record today's P&L.
4. Append today's trades to JOURNAL.md with full thesis, outcome, and lesson.
5. Update STRATEGY.md: what worked today, what didn't, any new pattern observed.
6. Update MARKET.md to close out today's candidates (mark FILLED/INVALIDATED/EXPIRED).

Be honest in your evaluation. If you made a mistake, record it clearly so you can learn from it.""",
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


def run(job_type: str, extra_prompt: str = "") -> str:
    """
    Run the agent for a given job type.

    job_type: 'premarket' | 'heartbeat' | 'eod'
    extra_prompt: additional context to append to the base prompt

    Returns the final text response from the agent.
    """
    if job_type not in PROMPTS:
        raise ValueError(f"Unknown job_type: {job_type}. Must be one of {list(PROMPTS.keys())}")

    activity_log.emit({"type": "job_start", "summary": f"{job_type} started"})

    # Build system prompt from SOUL.md + relevant memory files
    soul_path = Path("memory/SOUL.md")
    soul = soul_path.read_text() if soul_path.exists() else "You are an autonomous trading agent."

    context_files = {
        "premarket": ["memory/STRATEGY.md"],
        "execution": ["memory/MARKET.md"],
        "trigger":   ["memory/MARKET.md"],
        "eod":       ["memory/MARKET.md", "memory/JOURNAL.md"],
    }

    memory_parts = []
    for filepath in context_files.get(job_type, []):
        p = Path(filepath)
        if p.exists():
            memory_parts.append(f"## {p.name}\n\n{p.read_text()}")

    memory_context = "\n\n---\n\n".join(memory_parts)
    system = f"{soul}\n\n---\n\n{memory_context}" if memory_context else soul

    # Initial user message
    user_content = PROMPTS[job_type]
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
