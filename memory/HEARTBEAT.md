# Heartbeat Checklist

**Run every 5 minutes during market hours. Skip entirely if market is closed.**

If market is NOT open (09:15–15:30 IST, weekday): respond exactly `HEARTBEAT_OK`

---

## Checks to Run (in order)

### 1. Open Positions
Call `get_positions()` and then `get_market_quote()` for each held symbol.

- **Price <= stop loss?** → Call `exit_position()` immediately. Log reason as "stop loss hit".
- **Up >4% intraday from entry?** → Evaluate partial exit. Consider locking in profit if approaching resistance.
- **Time is 15:10–15:20 IST?** → Call `exit_position()` for ALL open positions immediately. Log reason as "MIS EOD exit — 3:20 PM auto-square-off imminent". Do not wait for the user to approve.

### 2. Daily Loss Check
Call `get_funds()`. If `day_pnl < -500`: halt all trading for today and send alert.

### 3. Intraday WATCH Triggers (9:45 AM–3:10 PM)
For any symbol still marked WATCH in MARKET.md, call `get_market_quote()`.
If price has reached the defined entry zone → call `place_trade()` to propose it.
Trust the pre-market thesis — do not re-analyse from scratch. One quote call, one decision.

### 4. Pending Approvals
Check if MARKET.md has any entries marked `PENDING APPROVAL`. Are they still valid given current price action? Update if stale.

### 4. Nothing Triggered
If none of the above conditions are met: respond exactly `HEARTBEAT_OK`

---

## Notes
- The MIS auto-square-off time on Dhan is **3:20 PM IST**. Exit positions by 3:15 PM at latest.
- During fast markets, stop losses may gap. Always check actual fill prices.
- Do NOT initiate new positions during heartbeat unless there is a very high-conviction setup already identified in MARKET.md.
