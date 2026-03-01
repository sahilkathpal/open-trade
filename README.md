# open-trade

An autonomous AI trading agent for the Indian equity market (NSE cash, MIS intraday). Claude reasons about news, technicals, and fundamentals — places trades on [Dhan](https://dhan.co) — and notifies you over Telegram. A web UI gives you a live view of positions, proposals, and the agent's memory.

No futures. No options.

---

## Try it

A hosted version is running at **[app.govib.trade](https://app.govib.trade)**. Sign up with your email, connect your Dhan account in Settings, optionally add Telegram, and you're live. No server setup required.

---

## What makes it work

**Claude is the trader, not the assistant.** It reads live data through tools, reasons abou
t setups, sizes positions, sets stop-losses and targets, and writes its thinking to memory files it reads again the next day. Python handles all arithmetic — position sizing, P&L, stop distances — so there's no risk of the LLM hallucinating a number that matters.

**Python enforces, Claude decides.** Every trade goes through `RiskGuard` before touching the broker API. The guard is hardcoded Python — the agent knows the rules but cannot change or bypass them.

**The heartbeat is deterministic.** Position monitoring runs every minute in pure Python with no LLM involved. Claude is only woken up during the day when a condition it set fires. This keeps costs low and latency zero for the critical path (stop-loss exits, profit locks).

---

## How it works

Five jobs run each trading day:

| Job | Time (IST) | What it does |
|-----|-----------|--------------|
| **Pre-market** | 8:45 AM | Reads news + charts, writes market canvas to `MARKET.md`, sets watchlist and wakeup conditions |
| **Execution** | 9:35 AM | First candle closed — refines entry levels, proposes trades |
| **Heartbeat** | Every 1 min (market hours) | Checks positions (SL / target / profit lock / EOD exit), evaluates wakeup conditions — pure Python, no LLM |
| **Clear proposals** | 3:20 PM | Discards pending approvals before MIS auto-square-off |
| **EOD** | 3:35 PM | Reviews the day, updates `JOURNAL.md` and `STRATEGY.md` |

---

## Wakeup conditions

Not everything can be decided at 8:45 AM. Markets move, setups evolve, and the right time to act on a thesis is often determined by what happens mid-session — a Nifty level breaking, a stock approaching its target, a news-driven spike.

During pre-market and execution, Claude writes conditions to `TRIGGERS.json`. The heartbeat evaluates them in Python every minute. When one fires, Claude is woken up with the current market context and its original reasoning — so it can decide what to do with real data, not pre-market guesses.

Examples of conditions Claude can set:
- `NIFTY50 crosses above 23,100` — re-evaluate the market view
- `POWERGRID price drops below ₹302` — check if thesis is still intact
- `open position P&L exceeds +2%` — consider locking gains or raising stop
- `at 11:00 AM` — review how morning setups played out

This is how Claude stays relevant through the session without being polled every minute.

Supported condition types: `price_above`, `price_below`, `index_above`, `index_below`, `near_stop`, `near_target`, `position_pnl_pct`, `day_pnl_above`, `day_pnl_below`, `time`.

---

## Guardrails

### RiskGuard — the code gate

Rules in `risk/guard.py`, enforced before every order. The agent cannot override them:

| Rule | Value |
|------|-------|
| No entries before 9:30 AM | Enforced — first candle not yet closed |
| Max position size | 40% of your configured agent capital |
| Stop-loss range | 1.5–2.5% below entry (mandatory) |
| Max open positions | Configurable (default: 2) |
| Available funds check | Position value cannot exceed account balance |

### Configurable limits

| Setting | Default | What it controls |
|---------|---------|-----------------|
| Agent capital | ₹10,000 | Position sizing and risk calculations |
| Daily loss limit | ₹500 | Agent halts new trades if day P&L drops below this |
| Max open positions | 2 | Hard cap enforced by RiskGuard |
| Profit lock | 4% | Heartbeat auto-exits if a position gains this much |

These are defaults. Set them to match your account size in the Settings page.

---

## Memory and learning

The agent is stateful across sessions through files it reads and writes:

| File | Purpose |
|------|---------|
| `SOUL.md` | Identity, values, and risk rules — written once by you |
| `MARKET.md` | Today's macro canvas, sector thesis, open positions — rewritten each morning |
| `STRATEGY.md` | Evolving edge — agent updates this at EOD based on what worked |
| `JOURNAL.md` | Append-only trade log: thesis, entry, exit, P&L, lesson |

---

## Dual-mode control

**Approval mode** (default): every trade proposal comes to Telegram for your approval. You reply `approve SYMBOL` or `deny SYMBOL`.

**Autonomous mode**: orders go straight through RiskGuard to Dhan. Toggle this from the Settings page at any time.

---

## Web UI

The web dashboard shows live positions, P&L, pending proposals, watchlist, active wakeup conditions, and a real-time activity feed. All configuration lives in Settings — no `.env` editing required once it's running.

Pages: **Dashboard**, **Market Brief** (today's MARKET.md), **Trade Journal** (JOURNAL.md), **Strategy** (STRATEGY.md), **Settings**.

---

## Self-hosting

### Prerequisites

- **Python 3.13** — required by `pandas-ta` / `numba`. Install via `brew install python@3.13`.
- **Dhan account** — [dhan.co](https://dhan.co). Enable API access in the developer console. Access tokens expire every 24 hours and must be refreshed each morning in Settings.
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com). Paid tier recommended; free tier will hit rate limits on multi-tool jobs.
- **Telegram bot** (optional) — create via [@BotFather](https://t.me/BotFather). Connect from the Settings page via QR code.

### Setup

```bash
git clone <repo-url>
cd open-trade

python3.13 -m venv .venv
source .venv/bin/activate
pip install -e .

cp .env.example .env
# Set ANTHROPIC_API_KEY (and optionally TELEGRAM_BOT_TOKEN)
```

Minimal `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=          # optional
```

Broker credentials, seed capital, and risk limits are configured through the web UI Settings page.

### Running

```bash
# API server + scheduler + Telegram bot
source .venv/bin/activate
uvicorn api.server:app --host 0.0.0.0 --port 8000

# Web UI (separate terminal)
cd web && npm run dev
```

Keep the API process running all day via `screen`, `tmux`, or systemd.

---

## Telegram commands

| Command | Effect |
|---------|--------|
| `/status` | Pending trade proposals |
| `/positions` | Open positions with P&L |
| `/funds` | Account balance |
| `/watchlist` | Active watchlist entries |
| `/triggers` | Active wakeup conditions |
| `approve SYMBOL` | Approve and place a pending trade |
| `deny SYMBOL` | Discard a pending proposal |
| `/run premarket\|execution\|eod` | Trigger a job immediately |
| `/exit SYMBOL` | Emergency exit a position |
| `/pause` / `/resume` | Pause or resume autonomous trading |

---

## Known limitations

- **Dhan access tokens expire every 24 hours.** Paste a fresh token in Settings each morning before the 8:45 AM pre-market job.
- **NSE holidays.** The scheduler does not check the NSE holiday calendar. Jobs fire but the agent finds no actionable setups and exits cleanly.
- **Single process.** Must stay running all day. Pending approvals survive restarts (persisted to disk); scheduler state resets.
