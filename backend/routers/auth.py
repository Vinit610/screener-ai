"""
Auth endpoints — onboarding and user profile.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import supabase
from dependencies.auth import get_current_user

router = APIRouter()


class OnboardingRequest(BaseModel):
    investment_style: Literal["value", "growth", "dividend"]


@router.get("/")
def auth_health():
    return {"message": "Auth router ready"}


@router.post("/onboarding")
async def complete_onboarding(
    req: OnboardingRequest,
    user_id: str = Depends(get_current_user),
):
    """Set the user's investment style and mark onboarding complete."""
    resp = (
        supabase.table("user_profiles")
        .update({
            "investment_style": req.investment_style,
            "onboarding_done": True,
        })
        .eq("id", user_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="User profile not found")
    return {"status": "ok"}


@router.get("/me")
async def get_me(user_id: str = Depends(get_current_user)):
    """Return the current user's profile."""
    resp = (
        supabase.table("user_profiles")
        .select("*")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="User profile not found")
    return resp.data