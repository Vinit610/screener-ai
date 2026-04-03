"""
Auth dependency — extracts and verifies the current user from the Authorization header.

Usage:
    from dependencies.auth import get_current_user

    @router.post("/something")
    async def endpoint(user_id: str = Depends(get_current_user)):
        ...
"""
from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from database import supabase

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """Verify the Supabase JWT and return the user ID.

    Raises HTTPException(401) if the token is missing or invalid.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    token = credentials.credentials

    try:
        user_resp = supabase.auth.get_user(token)
        if user_resp is None or user_resp.user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )
        return user_resp.user.id
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Token verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
