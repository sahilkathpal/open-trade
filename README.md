# open-trade

An autonomous AI trading agent for the Indian equity market. It uses [Claude](https://anthropic.com) to reason about news and price action, places trades on [Dhan](https://dhan.co), and sends you proposals + alerts over Telegram.

Seed capital: ₹10,000. Segment: NSE equity cash (MIS intraday). No futures, no options.

---

## How it works

Three scheduled jobs run each trading day:

| Job | Time (IST) | What it does |
|-----|-----------|--------------|
| **Pre-market** | 8:45 AM | Reads news, checks charts and fundamentals, writes a market canvas to `memory/MARKET.md`, proposes trades |
| **Heartbeat** | Every 5 min (9:15–3:30) | Checks open positions for stop-loss breach or target hit, monitors daily P&L |
| **EOD** | 3:35 PM | Reviews the day's trades, updates `memory/JOURNAL.md` and `memory/STRATEGY.md` |

The agent is stateful across sessions through five markdown files in `memory/`. It reads them at the start of each job and writes back at the end — no database required.

Trade approval flow (when `AUTONOMOUS=false`):

```
Agent analyses market
  → calls place_trade()
    → RiskGuard validates (hardcoded, cannot be overridden)
      → sends Telegram proposal to you
        → you reply "approve COALINDIA" or "deny COALINDIA"
          → order placed on Dhan
```

When `AUTONOMOUS=true` the approval step is skipped and orders go straight through.

---

## Architecture

```
open-trade/
├── agent/
│   ├── runner.py       # Core agentic loop — calls Claude, executes tools, loops until done
│   ├── scheduler.py    # APScheduler: pre-market cron, 5-min heartbeat, EOD cron
│   ├── telegram.py     # Bot: send notifications, receive approve/deny commands
│   ├── tools.py        # All tool definitions exposed to Claude
│   └── main.py         # Entry point: starts scheduler + Telegram in one asyncio loop
├── data/
│   ├── dhan_client.py  # Dhan API wrapper (quotes, history, orders, positions, funds)
│   ├── indicators.py   # pandas-ta: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, VWAP
│   ├── fundamentals.py # yfinance: P/E, margins, ROE, revenue growth, debt/equity
│   ├── news.py         # LiveMint RSS: markets, economy, companies, finance
│   └── universe.py     # NSE EQ instrument list (internal use — symbol → security_id)
├── risk/
│   └── guard.py        # Hardcoded risk rules — the agent cannot override these
└── memory/
    ├── SOUL.md         # System prompt: agent identity, mechanics, risk rules, tools
    ├── HEARTBEAT.md    # Checklist injected as context on every heartbeat run
    ├── MARKET.md       # Daily canvas: macro context, candidates, open positions
    ├── STRATEGY.md     # Evolving strategy — agent reads and updates this each day
    └── JOURNAL.md      # Append-only trade log with thesis, outcome, and lesson
```

The agent discovers trade candidates from news headlines and calls `get_historical_data` or `get_market_quote` with any NSE EQ ticker directly — the full instrument universe is available, not a preset list.

---

## Risk safeguards

All rules live in `risk/guard.py` and are enforced before any order reaches Dhan. The agent is aware of them but cannot change or bypass them:

| Rule | Value |
|------|-------|
| Max position size | 40% of seed capital (₹4,000) |
| Max open positions | 2 at a time |
| Stop loss range | 1.5% – 2.5% below entry (mandatory) |
| Daily loss limit | −₹500 (5% of ₹10,000) — no new trades after this |
| Available funds check | Position value cannot exceed available balance |

---

## Prerequisites

- **Python 3.13** — required because `pandas-ta` depends on `numba`, which does not support Python 3.14+. Install via `brew install python@3.13` on macOS.
- **Dhan account** — [dhan.co](https://dhan.co). Enable API access in the developer console. Note: access tokens expire every 24 hours and must be refreshed manually (OAuth auto-refresh is a planned improvement).
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com). The agentic loop uses multiple tool calls per job; a paid tier (Tier 1+) is recommended. Free tier (10k tokens/min) will hit rate limits.
- **Telegram bot** — create one via [@BotFather](https://t.me/BotFather), get your chat ID from [@userinfobot](https://t.me/userinfobot).

---

## Setup

```bash
# 1. Clone
git clone <repo-url>
cd open-trade

# 2. Create virtualenv with Python 3.13
python3.13 -m venv .venv
source .venv/bin/activate

# 3. Install
pip install -e .

# 4. Configure
cp .env.example .env
# Fill in all values — see .env.example for descriptions

# 5. Initialise memory files from templates
cp memory/MARKET.md.example memory/MARKET.md
cp memory/STRATEGY.md.example memory/STRATEGY.md
cp memory/JOURNAL.md.example memory/JOURNAL.md
```

`.env.example`:

```
ANTHROPIC_API_KEY=       # sk-ant-...
DHAN_CLIENT_ID=          # from Dhan developer console
DHAN_ACCESS_TOKEN=       # regenerate daily from Dhan dashboard
TELEGRAM_BOT_TOKEN=      # from @BotFather
TELEGRAM_CHAT_ID=        # your numeric chat ID
AUTONOMOUS=false         # set to true to skip trade approval
SEED_CAPITAL=10000       # used by RiskGuard for position sizing
DHAN_SANDBOX=false       # set to true to use Dhan sandbox (limited API support)
```

---

## Running

### Full agent (scheduler + Telegram bot)

```bash
source .venv/bin/activate
python -m agent.main
```

This starts the scheduler and the Telegram bot in the same process. Jobs fire automatically at their scheduled times. Keep this running all day (e.g. via `screen`, `tmux`, or a systemd service).

### Manual one-off runs

```bash
# Run just the pre-market job
python -c "from agent.runner import run; print(run('premarket'))"

# Run heartbeat
python -c "from agent.runner import run; print(run('heartbeat'))"

# Run EOD report
python -c "from agent.runner import run; print(run('eod'))"
```

### Smoke tests (verify data layer before running the agent)

```bash
# Dhan credentials + funds
python -c "from data.dhan_client import DhanClient; c = DhanClient(); print(c.get_funds())"

# Live quotes
python -c "from data.dhan_client import DhanClient; c = DhanClient(); print(c.get_quote(['RELIANCE', 'TCS']))"

# News feed
python -c "from data.news import fetch_news; [print(a['title']) for a in fetch_news()]"

# Fundamentals
python -c "from data.fundamentals import get_fundamentals; print(get_fundamentals('INFY'))"
```

---

## Telegram commands

Once the agent is running, talk to your bot:

| Message | Effect |
|---------|--------|
| `/start` | Show help |
| `/status` | List pending trade approvals |
| `approve SYMBOL` | Approve and place a pending trade (e.g. `approve COALINDIA`) |
| `deny SYMBOL` | Discard a pending trade proposal |
| `premarket` | Trigger pre-market analysis immediately |
| `heartbeat` | Trigger a heartbeat check immediately |
| `eod` | Trigger the EOD report immediately |

---

## Memory files

The agent's persistent state. Safe to read and edit manually.

| File | Written by | Purpose |
|------|-----------|---------|
| `SOUL.md` | You (once) | System prompt — identity, market mechanics, risk rules, tool list |
| `HEARTBEAT.md` | You (once) | Checklist the agent follows on every heartbeat run |
| `MARKET.md` | Agent (daily) | Today's macro context, sector thesis, trade candidates, positions |
| `STRATEGY.md` | Agent (EOD) | Evolving edge — what's working, what isn't, patterns observed |
| `JOURNAL.md` | Agent (EOD) | Append-only trade log: entry, exit, P&L, thesis, lesson |

---

## Paper trading vs live

Start with `AUTONOMOUS=false` (the default). Every trade proposal comes to Telegram for your approval. Run this for at least a week to:

- Verify risk rules reject oversized positions
- Confirm heartbeat exits stop-loss breaches
- Check that EOD writes to JOURNAL.md correctly
- Read STRATEGY.md to see if the agent's reasoning is sound

Only set `AUTONOMOUS=true` when you trust the agent's judgment. You can flip back to `false` at any time by editing `.env` and restarting the process.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `anthropic` | Claude API — powers the agent reasoning loop |
| `dhanhq` | Dhan brokerage API |
| `pandas-ta` | Technical indicators (RSI, MACD, Bollinger Bands, VWAP, ATR) |
| `yfinance` | Fundamentals (P/E, margins, ROE, revenue growth) |
| `feedparser` + `httpx` | LiveMint RSS news feed |
| `apscheduler` | Job scheduling (pre-market, heartbeat, EOD) |
| `python-telegram-bot` | Telegram notifications and approval flow |
| `python-dotenv` | `.env` configuration loading |

---

## Known limitations

- **Dhan access tokens expire every 24 hours.** You must paste a fresh token into `.env` each morning before the 8:45 AM pre-market job fires. OAuth auto-refresh is not yet implemented.
- **NSE holidays.** The scheduler does not check the NSE holiday calendar. On exchange holidays, jobs will run but the agent will find no actionable setups and exit cleanly.
- **Single machine.** The process must stay running all day. Pending approvals survive restarts (persisted to `memory/PENDING.json`), but scheduler state (last run times) resets.
