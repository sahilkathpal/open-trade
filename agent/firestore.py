"""
Firestore helpers for multi-tenant user management.
Falls back gracefully (returns empty data) if Firebase is not configured.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_db = None
_db_attempted = False


def _get_db():
    """Lazy-init Firestore client. Returns None if Firebase is not configured."""
    global _db, _db_attempted
    if _db_attempted:
        return _db
    _db_attempted = True
    try:
        import firebase_admin
        from firebase_admin import firestore as fs
        if not firebase_admin._apps:
            from api.firebase_admin import init_firebase
            init_firebase()
        if firebase_admin._apps:
            _db = fs.client()
    except Exception as e:
        logger.debug("Firestore not available: %s", e)
    return _db


def is_enabled() -> bool:
    """Return True if Firestore is configured and reachable."""
    return _get_db() is not None


def get_all_users() -> list[dict]:
    """Fetch all user documents. Returns [] if Firestore not configured."""
    db = _get_db()
    if not db:
        return []
    try:
        docs = db.collection("users").stream()
        users = []
        for doc in docs:
            data = doc.to_dict() or {}
            data["uid"] = doc.id
            users.append(data)
        return users
    except Exception as e:
        logger.error("get_all_users failed: %s", e)
        return []


def get_user(uid: str) -> Optional[dict]:
    """Fetch a single user document by UID. Returns None if not found."""
    db = _get_db()
    if not db:
        return None
    try:
        doc = db.collection("users").document(uid).get()
        if doc.exists:
            data = doc.to_dict() or {}
            data["uid"] = uid
            return data
        return None
    except Exception as e:
        logger.error("get_user(%s) failed: %s", uid, e)
        return None


def get_user_by_chat_id(chat_id: int) -> Optional[dict]:
    """Find a user doc by their linked Telegram chat_id."""
    db = _get_db()
    if not db:
        return None
    try:
        docs = (
            db.collection("users")
            .where("telegram_chat_id", "==", chat_id)
            .limit(1)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict() or {}
            data["uid"] = doc.id
            return data
        return None
    except Exception as e:
        logger.error("get_user_by_chat_id(%s) failed: %s", chat_id, e)
        return None


def update_user(uid: str, data: dict):
    """Merge-update fields in a user document."""
    db = _get_db()
    if not db:
        return
    try:
        db.collection("users").document(uid).set(data, merge=True)
    except Exception as e:
        logger.error("update_user(%s) failed: %s", uid, e)


def set_telegram_pending(code: str, uid: str):
    """Store a one-time code for Telegram deep-link account connection (15-min TTL)."""
    db = _get_db()
    if not db:
        return
    try:
        expires = datetime.now(timezone.utc) + timedelta(minutes=15)
        db.collection("telegram_pending").document(code).set(
            {"uid": uid, "expires_at": expires}
        )
    except Exception as e:
        logger.error("set_telegram_pending failed: %s", e)


def get_telegram_pending(code: str) -> Optional[str]:
    """Return uid for a pending Telegram code, or None if not found/expired."""
    db = _get_db()
    if not db:
        return None
    try:
        doc = db.collection("telegram_pending").document(code).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        expires = data.get("expires_at")
        if expires and datetime.now(timezone.utc) > expires:
            return None
        return data.get("uid")
    except Exception as e:
        logger.error("get_telegram_pending failed: %s", e)
        return None


def delete_telegram_pending(code: str):
    """Remove a used Telegram pending code."""
    db = _get_db()
    if not db:
        return
    try:
        db.collection("telegram_pending").document(code).delete()
    except Exception:
        pass
