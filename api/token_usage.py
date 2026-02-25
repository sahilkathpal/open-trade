"""
Daily token usage tracker. Persists to {memory_dir}/USAGE.json (per-user).

Format:
{
  "2026-02-25": {
    "input_tokens": 45230,
    "output_tokens": 12100,
    "api_calls": 18,
    "cost_usd": 0.24,
    "by_job": {
      "premarket":  {"input": 15000, "output": 4000, "calls": 6},
      "execution":  {"input": 12000, "output": 3500, "calls": 5},
      "heartbeat":  {"input": 8000,  "output": 2000, "calls": 4},
      "eod":        {"input": 10230, "output": 2600, "calls": 3}
    }
  }
}

Pricing (Claude Sonnet 4, as of Feb 2026):
  Input:  $3.00 / 1M tokens
  Output: $15.00 / 1M tokens
"""
import json
import threading
from datetime import datetime
from pathlib import Path

import pytz

_IST = pytz.timezone("Asia/Kolkata")
_lock = threading.Lock()

# Claude Sonnet 4 pricing (USD per token)
INPUT_PRICE = 3.00 / 1_000_000
OUTPUT_PRICE = 15.00 / 1_000_000

_FALLBACK_PATH = Path("memory/USAGE.json")


def _usage_path() -> Path:
    try:
        from agent.user_context import get_user_ctx
        ctx = get_user_ctx()
        return ctx.memory_dir / "USAGE.json"
    except Exception:
        return _FALLBACK_PATH


def _load(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {}


def _save(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def record(input_tokens: int, output_tokens: int, job_type: str):
    """Record token usage for one API call."""
    today = datetime.now(_IST).strftime("%Y-%m-%d")
    cost = (input_tokens * INPUT_PRICE) + (output_tokens * OUTPUT_PRICE)
    path = _usage_path()

    with _lock:
        data = _load(path)
        day = data.setdefault(today, {
            "input_tokens": 0,
            "output_tokens": 0,
            "api_calls": 0,
            "cost_usd": 0.0,
            "by_job": {},
        })

        day["input_tokens"] += input_tokens
        day["output_tokens"] += output_tokens
        day["api_calls"] += 1
        day["cost_usd"] = round(day["cost_usd"] + cost, 4)

        job = day["by_job"].setdefault(job_type, {"input": 0, "output": 0, "calls": 0})
        job["input"] += input_tokens
        job["output"] += output_tokens
        job["calls"] += 1

        _save(path, data)


def get_today() -> dict:
    """Return today's usage summary for the current user."""
    today = datetime.now(_IST).strftime("%Y-%m-%d")
    path = _usage_path()
    with _lock:
        data = _load(path)
        return data.get(today, {
            "date": today,
            "input_tokens": 0,
            "output_tokens": 0,
            "api_calls": 0,
            "cost_usd": 0.0,
            "by_job": {},
        })


def get_all() -> dict:
    """Return all historical usage data for the current user."""
    path = _usage_path()
    with _lock:
        return _load(path)
