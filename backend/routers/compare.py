"""
Comparison endpoint — structured side-by-side diff of two stocks or two MFs.
AI narrative is added in Phase 7 via a separate SSE endpoint.

GET /api/compare?symbol_a=INFY&symbol_b=TCS
GET /api/compare?scheme_code_a=118989&scheme_code_b=120644
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from cache import get_cache, set_cache
from database import supabase
from schemas.stock_schemas import CompareResponse

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_stock_snapshot(symbol: str) -> dict:
    """Return stock + latest fundamentals + latest price in one payload."""
    symbol = symbol.upper()
    stock_resp = (
        supabase.table("stocks")
        .select("*")
        .eq("symbol", symbol)
        .eq("is_active", True)
        .single()
        .execute()
    )
    if not stock_resp.data:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")
    stock = stock_resp.data

    fund_resp = (
        supabase.table("stock_fundamentals")
        .select(
            "pe,pb,roe,roce,debt_to_equity,net_margin,"
            "operating_margin,revenue_cr,net_profit_cr,eps,"
            "dividend_yield,book_value,graham_number"
        )
        .eq("stock_id", stock["id"])
        .maybe_single()
        .execute()
    )
    stock["fundamentals"] = fund_resp.data if fund_resp else None

    price_resp = (
        supabase.table("stock_prices")
        .select("date,close,volume")
        .eq("stock_id", stock["id"])
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    stock["latest_price"] = (price_resp.data or [None])[0]

    return stock


def _fetch_mf_snapshot(scheme_code: str) -> dict:
    """Return MF metadata + latest NAV."""
    fund_resp = (
        supabase.table("mutual_funds")
        .select("*")
        .eq("scheme_code", scheme_code)
        .single()
        .execute()
    )
    if not fund_resp.data:
        raise HTTPException(status_code=404, detail=f"Fund '{scheme_code}' not found")
    fund = fund_resp.data

    nav_resp = (
        supabase.table("mf_navs")
        .select("date,nav")
        .eq("fund_id", fund["id"])
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    fund["latest_nav"] = (nav_resp.data or [None])[0]

    return fund


# ── GET /compare ──────────────────────────────────────────────────────────────

@router.get("/", response_model=CompareResponse)
def compare(
    symbol_a: Optional[str] = Query(None, description="NSE symbol for stock A"),
    symbol_b: Optional[str] = Query(None, description="NSE symbol for stock B"),
    scheme_code_a: Optional[str] = Query(None, description="Scheme code for MF A"),
    scheme_code_b: Optional[str] = Query(None, description="Scheme code for MF B"),
):
    # Validate: must have either both stock symbols or both scheme codes
    is_stock_compare = symbol_a is not None and symbol_b is not None
    is_mf_compare = scheme_code_a is not None and scheme_code_b is not None

    if not is_stock_compare and not is_mf_compare:
        raise HTTPException(
            status_code=400,
            detail="Provide either (symbol_a + symbol_b) for stocks or (scheme_code_a + scheme_code_b) for MFs.",
        )
    if is_stock_compare and is_mf_compare:
        raise HTTPException(
            status_code=400,
            detail="Provide stock params OR MF params, not both.",
        )

    if is_stock_compare:
        cache_key = f"compare:stocks:{symbol_a.upper()}:{symbol_b.upper()}"
        cached = get_cache(cache_key)
        if cached is not None:
            return cached

        result = {
            "type": "stocks",
            "instrument_a": _fetch_stock_snapshot(symbol_a),
            "instrument_b": _fetch_stock_snapshot(symbol_b),
        }
        set_cache(cache_key, result, ex=1800)
        return result

    # MF comparison
    cache_key = f"compare:mf:{scheme_code_a}:{scheme_code_b}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    result = {
        "type": "mf",
        "instrument_a": _fetch_mf_snapshot(scheme_code_a),
        "instrument_b": _fetch_mf_snapshot(scheme_code_b),
    }
    set_cache(cache_key, result, ex=3600)
    return result
