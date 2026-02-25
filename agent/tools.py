import os
import json
from pathlib import Path
from datetime import datetime

from data.dhan_client import DhanClient
from data.indicators import compute_indicators
from data.fundamentals import get_fundamentals as _get_fundamentals
from data.news import fetch_news as _fetch_news
from risk.guard import RiskGuard

# ── singletons ────────────────────────────────────────────────────────────────
_dhan = DhanClient()
_risk = RiskGuard(seed_capital=float(os.getenv("SEED_CAPITAL", "10000")))

# Module-level store for pending trade approvals
# key: symbol, value: full trade params dict
# Persisted to memory/PENDING.json so proposals survive process restarts
_PENDING_PATH = Path("memory/PENDING.json")
_OPEN_POSITIONS_PATH = Path("memory/OPEN_POSITIONS.json")


def _load_open_positions() -> dict:
    if _OPEN_POSITIONS_PATH.exists():
        try:
            return json.loads(_OPEN_POSITIONS_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_open_positions(data: dict):
    _OPEN_POSITIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _OPEN_POSITIONS_PATH.write_text(json.dumps(data, indent=2))


def _load_pending() -> dict[str, dict]:
    if _PENDING_PATH.exists():
        try:
            return json.loads(_PENDING_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_pending():
    _PENDING_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PENDING_PATH.write_text(json.dumps(pending_approvals, indent=2))


pending_approvals: dict[str, dict] = _load_pending()

MEMORY_DIR = Path("memory")
ALLOWED_READ  = {"MARKET.md", "STRATEGY.md", "JOURNAL.md", "HEARTBEAT.md", "SOUL.md"}
ALLOWED_WRITE = {"MARKET.md", "STRATEGY.md"}


# ── helper ────────────────────────────────────────────────────────────────────
def _fmt_proposal(symbol, qty, entry, sl, target_est, thesis):
    rr = (target_est - entry) / (entry - sl) if entry != sl else 0
    return (
        f"\U0001f4ca *TRADE PROPOSAL*\n"
        f"Symbol: `{symbol}`\n"
        f"Direction: BUY\n"
        f"Entry: \u20b9{entry:.2f} | SL: \u20b9{sl:.2f} | Target: \u20b9{target_est:.2f}\n"
        f"Qty: {qty} | R:R = {rr:.1f}:1\n\n"
        f"Thesis: {thesis}\n\n"
        f"Reply `approve {symbol}` or `deny {symbol}`"
    )


# ── tool implementations ───────────────────────────────────────────────────────

def get_market_quote(symbols: list[str]) -> dict:
    try:
        return _dhan.get_quote(symbols)
    except Exception as e:
        return {"error": str(e)}


def get_historical_data(symbol: str, interval: str = "15", days: int = 30) -> dict:
    try:
        from datetime import timedelta
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        security_id = _dhan.symbol_to_security_id(symbol)
        df = _dhan.get_history(security_id, interval=interval, from_date=from_date, to_date=to_date)
        if df.empty:
            return {"symbol": symbol, "data": [], "error": "No data returned"}
        rows = compute_indicators(df)
        if not rows:
            return {"symbol": symbol, "error": "Indicator computation returned no rows"}

        # Return compact summary to keep token usage low:
        # - Period stats (high/low/avg_volume)
        # - Latest indicator snapshot (last row)
        # - Last 5 candles for recent price action
        last = rows[-1]
        closes = [r["close"] for r in rows if r.get("close") is not None]
        volumes = [r["volume"] for r in rows if r.get("volume") is not None]
        indicator_keys = [
            "RSI_14", "MACD_12_26_9", "MACDs_12_26_9", "MACDh_12_26_9",
            "SMA_20", "EMA_12", "EMA_26", "VWAP_D",
            "BBL_20_2.0", "BBM_20_2.0", "BBU_20_2.0", "ATRr_14",
        ]
        latest_indicators = {k: round(last[k], 2) for k in indicator_keys if last.get(k) is not None}
        recent_candles = [
            {k: r[k] for k in ("timestamp", "open", "high", "low", "close", "volume") if k in r}
            for r in rows[-5:]
        ]
        return {
            "symbol":   symbol,
            "interval": interval,
            "total_candles": len(rows),
            "period_high":   max(r["high"] for r in rows if r.get("high")),
            "period_low":    min(r["low"]  for r in rows if r.get("low")),
            "avg_volume":    round(sum(volumes) / len(volumes)) if volumes else None,
            "latest_close":  closes[-1] if closes else None,
            "indicators":    latest_indicators,
            "recent_candles": recent_candles,
        }
    except Exception as e:
        return {"error": str(e)}


def get_fundamentals(symbol: str) -> dict:
    try:
        return _get_fundamentals(symbol)
    except Exception as e:
        return {"error": str(e)}


def fetch_news(category: str = "markets", limit: int = 15) -> list[dict]:
    try:
        return _fetch_news(category=category, limit=limit)
    except Exception as e:
        return [{"error": str(e)}]



def get_positions() -> list:
    try:
        return _dhan.get_positions()
    except Exception as e:
        return [{"error": str(e)}]


def get_funds() -> dict:
    try:
        return _dhan.get_funds()
    except Exception as e:
        return {"error": str(e)}


def place_trade(
    symbol: str,
    security_id: str,
    transaction_type: str,
    quantity: int,
    entry_price: float,
    stop_loss_price: float,
    thesis: str,
    target_price: float = 0.0,
    approved: bool = False,
) -> dict:
    # 1. Always run risk validation first
    funds = _dhan.get_funds()
    positions = _dhan.get_positions()
    ok, reason = _risk.validate(
        entry_price=entry_price,
        quantity=quantity,
        stop_loss_price=stop_loss_price,
        open_position_count=len(positions),
        available_funds=funds.get("available_balance", 0),
        day_pnl=funds.get("day_pnl", 0),
    )
    if not ok:
        return {"status": "rejected", "reason": reason}

    # 2. Check approval requirement
    autonomous = os.getenv("AUTONOMOUS", "false").lower() == "true"
    if not approved and not autonomous:
        proposal = _fmt_proposal(symbol, quantity, entry_price, stop_loss_price,
                                  target_price or entry_price * 1.04, thesis)
        pending_approvals[symbol] = {
            "symbol": symbol,
            "security_id": security_id,
            "transaction_type": transaction_type,
            "quantity": quantity,
            "entry_price": entry_price,
            "stop_loss_price": stop_loss_price,
            "thesis": thesis,
            "target_price": target_price,
        }
        _save_pending()
        return {
            "status": "pending_approval",
            "proposal": proposal,
            "instruction": (
                "Send this proposal to the user via Telegram notification. "
                f"Call place_trade again with approved=True when they confirm symbol={symbol}."
            ),
        }

    # 3. Emit to activity feed so the UI shows what's being placed
    try:
        from api import activity_log
        rr = round((target_price - entry_price) / (entry_price - stop_loss_price), 1) if entry_price != stop_loss_price else 0
        activity_log.emit({
            "type": "trade",
            "symbol": symbol,
            "summary": f"AUTO {transaction_type} {symbol} @ ₹{entry_price} | SL ₹{stop_loss_price} | Target ₹{target_price} | R:R {rr}:1",
        })
    except Exception:
        pass

    # 4. Place entry order (market)
    entry_resp = _dhan.place_order(
        security_id=security_id,
        txn_type="BUY",
        qty=quantity,
        order_type="MARKET",
        product_type="INTRA",
        price=0,
    )

    # 4. Place stop-loss order
    sl_resp = _dhan.place_order(
        security_id=security_id,
        txn_type="SELL",
        qty=quantity,
        order_type="STOPLIMIT",
        product_type="INTRA",
        price=stop_loss_price,
        trigger_price=round(stop_loss_price * 1.001, 2),
    )

    # Track locally so the deterministic heartbeat knows SL/target/entry
    sl_order_id = None
    if isinstance(sl_resp, dict):
        sl_order_id = sl_resp.get("orderId") or sl_resp.get("data", {}).get("orderId")

    open_positions = _load_open_positions()
    open_positions[symbol] = {
        "security_id":    security_id,
        "entry_price":    entry_price,
        "stop_loss_price": stop_loss_price,
        "target_price":   target_price,
        "quantity":       quantity,
        "sl_order_id":    sl_order_id,
    }
    _save_open_positions(open_positions)

    return {
        "status":      "placed",
        "symbol":      symbol,
        "entry_order": entry_resp,
        "sl_order":    sl_resp,
    }


def exit_position(symbol: str, security_id: str, quantity: int, reason: str) -> dict:
    try:
        resp = _dhan.place_order(
            security_id=security_id,
            txn_type="SELL",
            qty=quantity,
            order_type="MARKET",
            product_type="INTRA",
            price=0,
        )
        # Cancel the associated SL order to free up blocked margin
        open_positions = _load_open_positions()
        sl_order_id = open_positions.get(symbol, {}).get("sl_order_id")
        if sl_order_id:
            try:
                _dhan.cancel_order(sl_order_id)
            except Exception:
                pass  # best-effort — don't fail the exit if cancel fails
        open_positions.pop(symbol, None)
        _save_open_positions(open_positions)
        return {"status": "exit_placed", "symbol": symbol, "reason": reason, "order": resp}
    except Exception as e:
        return {"error": str(e)}


def read_memory(filename: str) -> str:
    if filename not in ALLOWED_READ:
        return f"Error: {filename} not in allowed list {ALLOWED_READ}"
    path = MEMORY_DIR / filename
    if not path.exists():
        return f"File {filename} does not exist yet."
    return path.read_text()


def write_memory(filename: str, content: str) -> dict:
    if filename not in ALLOWED_WRITE:
        return {"error": f"{filename} not in allowed write list {ALLOWED_WRITE}"}
    path = MEMORY_DIR / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return {"status": "ok", "filename": filename, "bytes_written": len(content)}


def append_journal(entry: str) -> dict:
    path = MEMORY_DIR / "JOURNAL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(f"\n\n---\n\n{entry}")
    return {"status": "ok", "appended_bytes": len(entry)}


# ── tool executor ─────────────────────────────────────────────────────────────
TOOL_FUNCTIONS = {
    "get_market_quote":    get_market_quote,
    "get_historical_data": get_historical_data,
    "get_fundamentals":    get_fundamentals,
    "fetch_news":          fetch_news,
    "get_positions":       get_positions,
    "get_funds":           get_funds,
    "place_trade":         place_trade,
    "exit_position":       exit_position,
    "read_memory":         read_memory,
    "write_memory":        write_memory,
    "append_journal":      append_journal,
}


def execute_tool(name: str, inputs: dict):
    fn = TOOL_FUNCTIONS.get(name)
    if fn is None:
        return {"error": f"Unknown tool: {name}"}
    return fn(**inputs)


# ── Anthropic tool schemas ────────────────────────────────────────────────────
ALL_TOOL_SCHEMAS = [
    {
        "name": "get_market_quote",
        "description": "Get live LTP, OHLC, and volume for a list of NSE EQ symbols from Dhan.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of NSE ticker symbols (e.g. ['RELIANCE', 'TCS'])",
                }
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "get_historical_data",
        "description": (
            "Fetch OHLCV historical data with computed technical indicators "
            "(SMA20, EMA12, EMA26, RSI14, MACD, Bollinger Bands, ATR14, VWAP) for an NSE symbol."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol":   {"type": "string", "description": "NSE ticker symbol"},
                "interval": {
                    "type": "string",
                    "enum": ["1", "5", "15", "25", "60", "D"],
                    "description": "Candle interval: 1/5/15/25/60 minutes or D for daily",
                    "default": "15",
                },
                "days": {
                    "type": "integer",
                    "description": "Number of calendar days of history to fetch",
                    "default": 30,
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_fundamentals",
        "description": "Fetch fundamental data (P/E, margins, ROE, revenue growth, debt/equity) for an NSE symbol via yfinance.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "NSE ticker symbol without .NS suffix"}
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "fetch_news",
        "description": "Fetch latest financial news headlines from Business Standard RSS feeds.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["markets", "economy", "companies", "finance"],
                    "description": "News category",
                    "default": "markets",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of articles",
                    "default": 15,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_positions",
        "description": "Get current open positions from Dhan.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_funds",
        "description": "Get available balance, used margin, and day P&L from Dhan.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "place_trade",
        "description": (
            "Place a risk-validated trade on Dhan. Runs RiskGuard checks first. "
            "If AUTONOMOUS=false and not yet approved, returns a pending_approval proposal "
            "that must be sent to the user via Telegram."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol":            {"type": "string"},
                "security_id":       {"type": "string"},
                "transaction_type":  {"type": "string", "enum": ["BUY", "SELL"]},
                "quantity":          {"type": "integer"},
                "entry_price":       {"type": "number"},
                "stop_loss_price":   {"type": "number"},
                "thesis":            {"type": "string", "description": "1-2 sentence trade thesis"},
                "target_price":      {"type": "number", "description": "Estimated target price for R:R calculation"},
                "approved":          {"type": "boolean", "default": False},
            },
            "required": ["symbol", "security_id", "transaction_type", "quantity",
                         "entry_price", "stop_loss_price", "thesis"],
        },
    },
    {
        "name": "exit_position",
        "description": "Exit an open position with a market sell order. Logs the reason.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol":      {"type": "string"},
                "security_id": {"type": "string"},
                "quantity":    {"type": "integer"},
                "reason":      {"type": "string", "description": "Why exiting (e.g. 'stop loss hit', 'target reached')"},
            },
            "required": ["symbol", "security_id", "quantity", "reason"],
        },
    },
    {
        "name": "read_memory",
        "description": "Read a memory file (MARKET.md, STRATEGY.md, JOURNAL.md, HEARTBEAT.md, or SOUL.md).",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "enum": ["MARKET.md", "STRATEGY.md", "JOURNAL.md", "HEARTBEAT.md", "SOUL.md"],
                }
            },
            "required": ["filename"],
        },
    },
    {
        "name": "write_memory",
        "description": "Overwrite MARKET.md or STRATEGY.md with new content.",
        "input_schema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "enum": ["MARKET.md", "STRATEGY.md"],
                },
                "content": {"type": "string", "description": "Full new content of the file"},
            },
            "required": ["filename", "content"],
        },
    },
    {
        "name": "append_journal",
        "description": "Append a trade entry to JOURNAL.md. Use the standard format: Date | Symbol | Direction | Entry \u20b9 | Exit \u20b9 | Qty | P&L \u20b9 | R multiple.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry": {"type": "string", "description": "Formatted journal entry to append"}
            },
            "required": ["entry"],
        },
    },
]
