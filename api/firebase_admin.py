"""
Firebase Admin SDK initialization.
Call init_firebase() once at API startup. Safe to call multiple times.
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

_initialized = False


def init_firebase():
    """Initialize Firebase Admin from FIREBASE_SERVICE_ACCOUNT_KEY env var (JSON string)."""
    global _initialized
    if _initialized:
        return

    key_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
    if not key_json:
        logger.warning(
            "FIREBASE_SERVICE_ACCOUNT_KEY not set — Firebase disabled (single-user mode)"
        )
        return

    try:
        import firebase_admin
        from firebase_admin import credentials

        if firebase_admin._apps:
            _initialized = True
            return

        cred_dict = json.loads(key_json)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        _initialized = True
        logger.info("Firebase Admin SDK initialized (project: %s)", cred_dict.get("project_id"))
    except Exception as e:
        logger.error("Firebase initialization failed: %s", e)


def verify_id_token(token: str) -> str:
    """Verify a Firebase ID token and return the uid. Raises ValueError on failure."""
    try:
        import firebase_admin.auth as auth
        decoded = auth.verify_id_token(token)
        return decoded["uid"]
    except Exception as e:
        raise ValueError(f"Invalid Firebase token: {e}")
