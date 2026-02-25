"""
FastAPI authentication dependency.

Resolves a Firebase ID token → uid → UserContext and sets it for the request.
Falls back to single-user env-var mode if Firebase is not configured.
"""
import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


def get_current_uid(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Security(_bearer)
    ] = None,
) -> str:
    """
    Extract uid from Authorization: Bearer <firebase-id-token>.
    Returns 'default' if Firebase is not configured (single-user mode).
    Raises 401 if Firebase is configured but token is missing/invalid.
    """
    from api.firebase_admin import _initialized, verify_id_token

    if not _initialized:
        return "default"

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )

    try:
        return verify_id_token(credentials.credentials)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
