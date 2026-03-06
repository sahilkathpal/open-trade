# open-trade

An autonomous AI trading agent for the Indian equity market (NSE cash). Claude reasons about news, technicals, and fundamentals — places trades on [Dhan](https://dhan.co) — and notifies you over Telegram. A web UI gives you a live view of positions, proposals, and the agent's reasoning per strategy.

No futures. No options.

---

## Try it

A hosted version is running at **[app.govib.trade](https://app.govib.trade)**. Sign up with your email, connect your Dhan account in Settings, optionally add Telegram, and you're live. No server setup required.

---

## What makes it work

**Claude is the trader, not the assistant.** It reads live data through tools, reasons about setups, sizes positions, sets stop-losses and targets, and writes its thinking to memory it reads again the next day. Python handles all arithmetic — position sizing, P&L, stop distances — so there's no risk of the LLM hallucinating a number that matters.

**Strategies are first-class.** Each strategy has its own thesis, rules, and learnings stored in Firestore. Capital, risk limits, and autonomy are configured per strategy. All positions and trades are scoped to the strategy that produced them.

**Claude owns its own schedule.** There are no hardcoded job definitions. Claude writes its own recurring jobs via `write_schedule()` — specifying the cron, the prompt, and the reason. Schedules are separate from strategy rules and can be changed independently. They load into APScheduler on startup and persist across restarts.

**Python enforces, Claude decides.** Every trade goes through `RiskGuard` before touching the broker API. The guard is hardcoded Python — the agent knows the rules but cannot change or bypass them.

**The heartbeat is deterministic.** Position monitoring runs every minute in pure Python with no LLM involved. Claude is only woken up when a condition it set fires. This keeps costs low and latency zero for the critical path (stop-loss exits, EOD hard exits).

---

## How it works

One infrastructure job runs all day. Everything else is Claude-owned:

| Job | Time (IST) | What it does |
|-----|-----------|--------------|
| **Heartbeat** | Every 1 min (market hours) | Checks positions (SL / target / EOD exit), evaluates triggers — pure Python, no LLM |
| **Pre-market** | Claude-scheduled | Reads news + charts, identifies catalyst-driven candidates, sets EOD hard exit trigger |
| **Execution** | Claude-scheduled | Opening range formed — evaluates entry checklist, places trades, sets monitoring triggers |
| **EOD review** | Claude-scheduled | Reviews the day, journals trades, appends to strategy learnings |

Pre-market, execution, and EOD jobs are written by Claude via `write_schedule()` when a strategy is first set up, and persist from there. View and remove them via `GET /api/schedules` or the Telegram `/schedule` command.

---

## Triggers

Not everything can be decided at pre-market. During setup and execution, Claude writes conditions via `write_trigger()`. The heartbeat evaluates them every minute in Python. When one fires, Claude is woken up with the current market context and its original reasoning.

Hard triggers execute directly — no LLM. Soft triggers invoke Claude.

**Hard trigger examples:**
- `at 15:10` with `action=exit_all` — deterministic EOD backstop exit, set each morning
- `price_in_range` with `action=place_trade` — entry fires when stock enters the zone during the entry window

**Soft trigger examples:**
- `NIFTY50 crosses above 23,100` — re-evaluate the market view
- `open position P&L exceeds +2%` — consider locking gains or raising stop
- `at 11:00 AM` — review how morning setups played out

Supported types: `price_above`, `price_below`, `price_in_range`, `index_above`, `index_below`, `near_stop`, `near_target`, `position_pnl_pct`, `day_pnl_above`, `day_pnl_below`, `time`.

---

## Strategies

Each strategy is a Firestore document with its own isolated context:

| Field | What it holds |
|-------|--------------|
| `thesis` | The investment hypothesis — why this edge exists |
| `rules` | Trading logic only — entry criteria, exit conditions, sizing, risk limits, product type (MIS/CNC) |
| `learnings` | Post-trade observations appended by Claude after EOD review |
| `capital_allocation` | INR amount ring-fenced for this strategy |
| `autonomy` | `approval` (default) or `autonomous` — controls Tier 2 approval gates per strategy |

Schedules are not part of rules. A strategy with thesis and rules but no schedule will not run — Claude always sets up schedules in the same conversation where a strategy is created.

Strategy proposals, thesis/rules updates, and archiving always require explicit user approval. Each update is version-snapshotted automatically so you can see the full history of how a strategy evolved.

---

## Guardrails

Rules in `risk/guard.py`, enforced before every order. The agent cannot override them:

| Rule | Value |
|------|-------|
| No entries before 9:30 AM | Enforced — first candle not yet closed |
| Stop-loss required | Must be below entry price |
| Max risk per trade | 2% of strategy allocation (configurable) |
| Available funds check | Position value cannot exceed account balance |
| Max open positions | Configurable (default: 2), enforced in `place_trade` |
| Strategy allocation | Trades blocked if no capital is allocated to the strategy |

---

## Permission tiers

| Tier | Tools | When approval required |
|------|-------|----------------------|
| 0 — read | Market data, positions, strategy reads | Never |
| 1 — auto-write | Journal, learnings, soft triggers | Never |
| 2 — conditional | place_trade, exit_position, update_thesis/rules, write_schedule | When not autonomous (global or per-strategy) |
| 3 — always | propose_strategy, archive_strategy, set_strategy_allocation, set_strategy_autonomy | Always |

Approval requests appear as inline cards in the chat. Telegram `approve` / `deny` commands work as a fallback.

---

## Memory

The agent is stateful across sessions:

| Store | Purpose |
|-------|---------|
| `SOUL.md` | Identity, values, and risk philosophy — shared across all users |
| `HEARTBEAT.md` | Heartbeat logic reference — shared |
| Strategy `thesis` | Investment hypothesis (Firestore) |
| Strategy `rules` | Trading logic (Firestore) — versioned on every update |
| Strategy `learnings` | Accumulated EOD observations (Firestore) |
| `JOURNAL.md` | Append-only trade log per user |
| `SCHEDULE.json` / Firestore | Claude-owned recurring jobs |
| `TRIGGERS.json` | Active intraday conditions |

---

## Dual-mode control

**Approval mode** (default): every trade proposal appears as an inline card in the chat and a Telegram push. Approve or deny in either place. Proposals expire automatically before MIS square-off.

**Autonomous mode**: orders go straight through RiskGuard to Dhan. Toggle globally from Settings, or per-strategy by asking Claude in that strategy's chat.

---

## Push notifications

Telegram receives a push for every meaningful event:

| Event | Message |
|-------|---------|
| Trade proposal (approval mode) | Entry, SL, target, R:R, thesis summary |
| Trade placed | Entry ₹X \| Qty N \| SL ₹X \| Target ₹X \| R:R |
| Position exited | Exit price, P&L, reason |
| SL hit | Condition that fired (heartbeat) |
| Target hit | Condition that fired (heartbeat) |
| Trigger fired | Condition context (heartbeat) |
| Token expired | Once per day |

---

## Web UI

| Page | What it shows |
|------|--------------|
| **Portfolio** | All strategies with lifetime P&L, live positions across strategies, activity feed |
| **Strategy — Trades** | Open positions + completed trade journal with cumulative P&L |
| **Strategy — Learnings** | Claude's accumulated observations for this strategy |
| **Strategy — Versions** | Full history of thesis and rules changes with timestamps and labels |
| **Strategy — Agent** | Activity feed of tool calls and job runs; token usage |
| **Strategy — Documents** | Strategy memory files read-only |
| **Strategy — Guardrails** | Capital allocation, risk limits, autonomy mode |
| **Settings** | Broker credentials, seed capital, Telegram connection |

---

## Telegram

| Command | Effect |
|---------|--------|
| `/status` | Pending trade proposals |
| `/positions` | Open positions with live P&L |
| `/funds` | Account balance and day P&L |
| `/triggers` | Active intraday conditions |
| `/watchlist` | Entry candidates (hard triggers with `action=place_trade`) |
| `/pause` / `/resume` | Pause or resume autonomous trading |
| `/run premarket\|execution\|eod` | Manually trigger a scheduled job |
| `/exit SYMBOL` | Emergency market exit |
| `approve SYMBOL` | Approve and place a pending trade |
| `deny SYMBOL` | Discard a pending proposal |

Connect Telegram from the Settings page via a one-time deep link.

---

## Self-hosting

### Prerequisites

- **Python 3.11+**
- **Dhan account** — [dhan.co](https://dhan.co). Enable API access in the developer console. Access tokens expire every 24 hours.
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com). Paid tier recommended.
- **Firebase project** — required for the web UI and multi-user mode. See below.
- **Telegram bot** (optional) — create via [@BotFather](https://t.me/BotFather).

### Firebase setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password
3. Enable **Firestore** → Start in test mode, then apply the security rules from `docs/firestore-rules.md`
4. Add a web app → copy the config into `web/.env.local`
5. Generate a service account key → paste the JSON as `FIREBASE_SERVICE_ACCOUNT_KEY` in `.env`

### Running

```bash
git clone <repo-url>
cd open-trade

# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies and start the backend
uv sync
uv run api

# Web UI (separate terminal)
cd web && npm run dev
```

Sign up at `http://localhost:3000`, go to Settings, and save your Dhan credentials. That creates your Firestore user document and the agent is ready.

Keep the backend process running all day via `screen`, `tmux`, or systemd. The scheduler reloads from Firestore on startup so Claude-owned jobs are restored automatically.

---

## Known limitations

- **Dhan access tokens expire every 24 hours.** Paste a fresh token in Settings each morning before the pre-market job runs. The heartbeat detects expiry and sends a Telegram alert.
- **Single process.** Must stay running all day. If it restarts mid-session, the scheduler reloads from Firestore but any in-flight agent reasoning is lost.
- **MIS and CNC supported.** Intraday (MIS) positions are exited by the 15:10 hard trigger each day. CNC positions are monitored by the heartbeat but not force-exited.
