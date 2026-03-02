# Heartbeat — Python Monitor Reference

Runs every 5 minutes during market hours (9:15–15:30 IST, Mon–Fri). Skips silently outside hours.

---

## Every tick (pure Python, no LLM)

### 1. Token expiry check
If the Dhan access token is expired, send a Telegram alert (at most once per day) and skip all
further checks for this tick. No trades are placed when the token is invalid.

### 2. Daily loss limit
Call `get_funds()`. If `day_pnl < daily_loss_limit` (from user settings), halt trading for the
session and send a Telegram alert. No further checks or trades on this tick.

### 3. Open position exits
For each entry in `OPEN_POSITIONS.json`, fetch the current LTP via `get_market_quote()`:

| Condition | Action |
|-----------|--------|
| `LTP ≤ stop_loss_price` | `exit_position()` — reason: "stop loss hit" |
| `LTP ≥ target_price` (if set) | `exit_position()` — reason: "target reached" |
| `LTP ≥ entry × (1 + profit_lock_pct)` (if set) | `exit_position()` — reason: "profit lock" |

After exit, the position is removed from `OPEN_POSITIONS.json` and the SL order is cancelled.

### 4. Trigger evaluation
Load `TRIGGERS.json`. Discard any triggers whose `expires_at` has passed.

For each active trigger, evaluate its condition:

**Hard triggers (`mode="hard"`)** — execute directly, no Claude:
- `action="place_trade"` (requires `type="price_in_range"`): calls `place_trade()` with the
  embedded trade parameters when the price enters the defined range.
- `action="exit_all"`: calls `exit_position()` for every entry in `OPEN_POSITIONS.json`.

**Soft triggers (`mode="soft"`)** — invoke the Claude agent:
The agent receives the trigger context (condition, reason, symbol) plus a fresh market snapshot.
Claude reads the situation and decides: exit, enter, add to watchlist, or set a follow-up trigger.

Triggers are one-shot — they are removed after firing regardless of outcome.

---

## EOD exit

Each morning during the premarket job, Claude sets a hard time trigger:

```
write_trigger(
    id="eod-exit",
    type="time",
    at="15:10",
    mode="hard",
    action="exit_all",
    reason="MIS EOD — exit all open positions before Dhan auto-square-off at 3:20",
    expires_at="<today>T23:59:00+05:30",
)
```

At 15:10, the heartbeat fires this trigger and exits all tracked positions. No Claude invocation
on this tick. The hard exit ensures positions are always flat before Dhan's 15:20 auto-square-off.

---

## Claude's role

Claude only runs when a **soft trigger** fires. It is never invoked on a normal heartbeat tick.

When invoked by a soft trigger, Claude:
1. Reads STRATEGY.md for context
2. Fetches live market data for the relevant symbols
3. Decides to exit, enter, add to watchlist, or set a follow-up trigger
4. Returns a summary sent to Telegram

---

## File references

| File | Purpose |
|------|---------|
| `OPEN_POSITIONS.json` | Positions tracked by the agent (SL/target/entry stored here) |
| `TRIGGERS.json` | Active monitoring triggers set by Claude |
| `SCHEDULE.json` | Recurring jobs set by Claude (loaded into APScheduler) |
| `WATCHLIST.json` | Price-range entries for automatic place_trade via heartbeat |
