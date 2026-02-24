"""
Daily token usage tracker. Persists to memory/USAGE.json.

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
from datetime import datetime, timezone
from pathlib import Path

import pytz

_IST = pytz.timezone("Asia/Kolkata")
_USAGE_PATH = Path("memory/USAGE.json")
_lock = threading.Lock()

# Claude Sonnet 4 pricing (USD per token)
INPUT_PRICE = 3.00 / 1_000_000
OUTPUT_PRICE = 15.00 / 1_000_000


def _load() -> dict:
    if _USAGE_PATH.exists():
        try:
            return json.loads(_USAGE_PATH.read_text())
        except Exception:
            pass
    return {}


def _save(data: dict):
    _USAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _USAGE_PATH.write_text(json.dumps(data, indent=2))


def record(input_tokens: int, output_tokens: int, job_type: str):
    """Record token usage for one API call."""
    today = datetime.now(_IST).strftime("%Y-%m-%d")
    cost = (input_tokens * INPUT_PRICE) + (output_tokens * OUTPUT_PRICE)

    with _lock:
        data = _load()
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

        _save(data)


def get_today() -> dict:
    """Return today's usage summary."""
    today = datetime.now(_IST).strftime("%Y-%m-%d")
    with _lock:
        data = _load()
        return data.get(today, {
            "date": today,
            "input_tokens": 0,
            "output_tokens": 0,
            "api_calls": 0,
            "cost_usd": 0.0,
            "by_job": {},
        })


def get_all() -> dict:
    """Return all historical usage data."""
    with _lock:
        return _load()
