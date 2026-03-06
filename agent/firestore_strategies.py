"""
Firestore helpers for per-user, per-strategy data.

All functions return gracefully ([] or None) when Firestore is not configured.

Schema:
  users/{uid}/strategies/{strategy_id}
    id, name, status, capital_allocation, risk_config, thesis, rules, learnings,
    created_at, updated_at

  users/{uid}/strategies/{strategy_id}/schedules/{schedule_id}
    id, cron, reason, prompt, created_at, last_run, strategy_id

  users/{uid}/strategies/{strategy_id}/open_positions/{symbol}
    entry_price, sl_price, target_price, quantity, security_id, product_type,
    order_id, sl_order_id, placed_at, strategy_id

  users/{uid}/strategies/{strategy_id}/trades/{trade_id}
    symbol, entry_price, exit_price, quantity, realized_pnl, placed_at, exited_at,
    thesis, product_type, trade_id
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def _get_db():
    """Lazy-init Firestore client. Returns None if Firebase is not configured."""
    from agent.firestore import _get_db as _base_get_db
    return _base_get_db()


# ── Strategy CRUD ─────────────────────────────────────────────────────────────

def create_strategy(uid: str, strategy_id: str, doc: dict) -> bool:
    """Create a new strategy document. Returns True on success."""
    db = _get_db()
    if not db:
        return False
    try:
        now = datetime.now(timezone.utc).isoformat()
        data = {
            "id": strategy_id,
            "status": "active",
            "created_at": now,
            "updated_at": now,
            **doc,
        }
        db.collection("users").document(uid).collection("strategies").document(strategy_id).set(data)
        return True
    except Exception as e:
        logger.error("create_strategy(%s, %s) failed: %s", uid, strategy_id, e)
        return False


def get_strategy(uid: str, strategy_id: str) -> Optional[dict]:
    """Fetch a single strategy document. Returns None if not found."""
    db = _get_db()
    if not db:
        return None
    try:
        doc = (
            db.collection("users").document(uid)
            .collection("strategies").document(strategy_id).get()
        )
        if doc.exists:
            data = doc.to_dict() or {}
            data["id"] = strategy_id
            return data
        return None
    except Exception as e:
        logger.error("get_strategy(%s, %s) failed: %s", uid, strategy_id, e)
        return None


def list_strategies(uid: str) -> list[dict]:
    """Fetch all strategy documents for a user. Returns [] if Firestore not configured."""
    db = _get_db()
    if not db:
        return []
    try:
        docs = (
            db.collection("users").document(uid)
            .collection("strategies").stream()
        )
        strategies = []
        for doc in docs:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            strategies.append(data)
        return sorted(strategies, key=lambda s: s.get("created_at", ""))
    except Exception as e:
        logger.error("list_strategies(%s) failed: %s", uid, e)
        return []


def update_strategy(uid: str, strategy_id: str, fields: dict) -> bool:
    """Merge-update fields in a strategy document."""
    db = _get_db()
    if not db:
        return False
    try:
        fields = dict(fields)
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        db.collection("users").document(uid).collection("strategies").document(strategy_id).set(
            fields, merge=True
        )
        return True
    except Exception as e:
        logger.error("update_strategy(%s, %s) failed: %s", uid, strategy_id, e)
        return False


def archive_strategy(uid: str, strategy_id: str) -> bool:
    """Set strategy status to 'archived'."""
    return update_strategy(uid, strategy_id, {"status": "archived"})


# ── Open Positions ─────────────────────────────────────────────────────────────

def get_open_positions(uid: str, strategy_id: Optional[str] = None) -> dict:
    """
    Get open positions. If strategy_id given, returns only that strategy's positions.
    Otherwise merges all strategies.
    Returns dict keyed by symbol.
    """
    db = _get_db()
    if not db:
        return {}
    try:
        if strategy_id:
            docs = (
                db.collection("users").document(uid)
                .collection("strategies").document(strategy_id)
                .collection("open_positions").stream()
            )
            result = {}
            for doc in docs:
                data = doc.to_dict() or {}
                data["strategy_id"] = strategy_id
                result[doc.id] = data
            return result
        else:
            strategies = list_strategies(uid)
            result = {}
            for strat in strategies:
                sid = strat.get("id", "")
                if not sid:
                    continue
                docs = (
                    db.collection("users").document(uid)
                    .collection("strategies").document(sid)
                    .collection("open_positions").stream()
                )
                for doc in docs:
                    data = doc.to_dict() or {}
                    data["strategy_id"] = sid
                    result[doc.id] = data
            return result
    except Exception as e:
        logger.error("get_open_positions(%s) failed: %s", uid, e)
        return {}


def set_open_position(uid: str, strategy_id: str, symbol: str, data: dict) -> bool:
    """Write or update an open position record."""
    db = _get_db()
    if not db:
        return False
    try:
        record = dict(data)
        record.setdefault("placed_at", datetime.now(timezone.utc).isoformat())
        record["strategy_id"] = strategy_id
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("open_positions").document(symbol).set(record)
        return True
    except Exception as e:
        logger.error("set_open_position(%s, %s, %s) failed: %s", uid, strategy_id, symbol, e)
        return False


def delete_open_position(uid: str, strategy_id: str, symbol: str) -> bool:
    """Remove an open position record."""
    db = _get_db()
    if not db:
        return False
    try:
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("open_positions").document(symbol).delete()
        return True
    except Exception as e:
        logger.error("delete_open_position(%s, %s, %s) failed: %s", uid, strategy_id, symbol, e)
        return False


# ── Trade History ──────────────────────────────────────────────────────────────

def record_trade(uid: str, strategy_id: str, trade: dict) -> bool:
    """Record a completed trade in the trades subcollection."""
    db = _get_db()
    if not db:
        return False
    try:
        record = dict(trade)
        trade_id = record.get("trade_id") or str(uuid.uuid4())
        record["trade_id"] = trade_id
        record.setdefault("exited_at", datetime.now(timezone.utc).isoformat())
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("trades").document(trade_id).set(record)
        return True
    except Exception as e:
        logger.error("record_trade(%s, %s) failed: %s", uid, strategy_id, e)
        return False


def list_trades(uid: str, strategy_id: str, limit: int = 50) -> list[dict]:
    """List recent trades for a strategy, ordered by exited_at descending."""
    db = _get_db()
    if not db:
        return []
    try:
        docs = (
            db.collection("users").document(uid)
            .collection("strategies").document(strategy_id)
            .collection("trades")
            .order_by("exited_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        logger.error("list_trades(%s, %s) failed: %s", uid, strategy_id, e)
        return []


def get_strategy_pnl(uid: str, strategy_id: str) -> dict:
    """Aggregate realized P&L from trades subcollection."""
    trades = list_trades(uid, strategy_id, limit=500)
    total_realized = sum(t.get("realized_pnl", 0) or 0 for t in trades)
    total_trades = len(trades)
    wins = sum(1 for t in trades if (t.get("realized_pnl") or 0) > 0)
    return {
        "strategy_id": strategy_id,
        "total_realized": round(total_realized, 2),
        "total_trades": total_trades,
        "wins": wins,
        "losses": total_trades - wins,
        "win_rate": round(wins / total_trades * 100, 1) if total_trades > 0 else 0.0,
    }


# ── Schedules ──────────────────────────────────────────────────────────────────

def get_strategy_schedules(uid: str, strategy_id: str) -> list[dict]:
    """Get all schedules for a strategy."""
    db = _get_db()
    if not db:
        return []
    try:
        docs = (
            db.collection("users").document(uid)
            .collection("strategies").document(strategy_id)
            .collection("schedules").stream()
        )
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        logger.error("get_strategy_schedules(%s, %s) failed: %s", uid, strategy_id, e)
        return []


def set_strategy_schedule(uid: str, strategy_id: str, entry: dict) -> bool:
    """Write a schedule entry for a strategy."""
    db = _get_db()
    if not db:
        return False
    try:
        schedule_id = entry.get("id")
        if not schedule_id:
            return False
        record = dict(entry)
        record["strategy_id"] = strategy_id
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("schedules").document(schedule_id).set(record)
        return True
    except Exception as e:
        logger.error("set_strategy_schedule(%s, %s) failed: %s", uid, strategy_id, e)
        return False


def delete_strategy_schedule(uid: str, strategy_id: str, schedule_id: str) -> bool:
    """Delete a schedule entry."""
    db = _get_db()
    if not db:
        return False
    try:
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("schedules").document(schedule_id).delete()
        return True
    except Exception as e:
        logger.error("delete_strategy_schedule(%s, %s, %s) failed: %s", uid, strategy_id, schedule_id, e)
        return False


def get_all_schedules(uid: str) -> list[dict]:
    """Get all schedules across all strategies for a user."""
    db = _get_db()
    if not db:
        return []
    try:
        strategies = list_strategies(uid)
        all_schedules = []
        for strat in strategies:
            sid = strat.get("id", "")
            if not sid:
                continue
            docs = (
                db.collection("users").document(uid)
                .collection("strategies").document(sid)
                .collection("schedules").stream()
            )
            for doc in docs:
                data = doc.to_dict() or {}
                data.setdefault("strategy_id", sid)
                all_schedules.append(data)
        return all_schedules
    except Exception as e:
        logger.error("get_all_schedules(%s) failed: %s", uid, e)
        return []


def update_schedule_last_run(uid: str, strategy_id: str, schedule_id: str) -> bool:
    """Update the last_run timestamp for a schedule entry."""
    db = _get_db()
    if not db:
        return False
    try:
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("schedules").document(schedule_id).set(
            {"last_run": datetime.now(timezone.utc).isoformat()}, merge=True
        )
        return True
    except Exception as e:
        logger.error("update_schedule_last_run(%s, %s, %s) failed: %s", uid, strategy_id, schedule_id, e)
        return False


# ── Strategy Versions ──────────────────────────────────────────────────────────

def save_version(uid: str, strategy_id: str, thesis: str, rules: str, change: str) -> str:
    """Snapshot current thesis+rules before an update. Returns version_id."""
    db = _get_db()
    if not db:
        return ""
    try:
        version_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        record = {
            "version_id": version_id,
            "thesis": thesis or "",
            "rules": rules or "",
            "label": None,
            "created_at": now,
            "change": change,
        }
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("versions").document(version_id).set(record)
        return version_id
    except Exception as e:
        logger.error("save_version(%s, %s) failed: %s", uid, strategy_id, e)
        return ""


def list_versions(uid: str, strategy_id: str, limit: int = 20) -> list[dict]:
    """List versions sorted by created_at descending."""
    db = _get_db()
    if not db:
        return []
    try:
        docs = (
            db.collection("users").document(uid)
            .collection("strategies").document(strategy_id)
            .collection("versions")
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() for doc in docs]
    except Exception as e:
        logger.error("list_versions(%s, %s) failed: %s", uid, strategy_id, e)
        return []


def label_version(uid: str, strategy_id: str, version_id: str, label: str) -> bool:
    """Set human label on a version."""
    db = _get_db()
    if not db:
        return False
    try:
        db.collection("users").document(uid).collection("strategies").document(strategy_id).collection("versions").document(version_id).set(
            {"label": label}, merge=True
        )
        return True
    except Exception as e:
        logger.error("label_version(%s, %s, %s) failed: %s", uid, strategy_id, version_id, e)
        return False
