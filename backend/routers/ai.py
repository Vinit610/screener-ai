"""
AI endpoints — NL→filter, stock explanation (SSE), comparison narrative (SSE).
"""
from __future__ import annotations

import hashlib
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from cache import get_cache, set_cache
from database import supabase
from services import ai_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ParseQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)


class ExplainRequest(BaseModel):
    symbol: str
    investment_style: str = "value"


class CompareRequest(BaseModel):
    symbol_a: str
    symbol_b: str
    investment_style: str = "value"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_stock_with_fundamentals(symbol: str) -> dict:
    """Fetch stock row + fundamentals for a symbol. Raises HTTPException(404)."""
    symbol = symbol.upper()
    stock_resp = (
        supabase.table("stocks")
        .select("*")
        .eq("symbol", symbol)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if not stock_resp.data:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")
    stock = stock_resp.data

    fund_resp = (
        supabase.table("stock_fundamentals")
        .select("*")
        .eq("stock_id", stock["id"])
        .maybe_single()
        .execute()
    )
    fundamentals = fund_resp.data or {}

    return {
        "name": stock.get("name", symbol),
        "symbol": symbol,
        "sector": stock.get("sector", "N/A"),
        "market_cap_cr": stock.get("market_cap_cr"),
        "fundamentals": fundamentals,
        # Flatten for prompt template convenience
        "pe": fundamentals.get("pe"),
        "pb": fundamentals.get("pb"),
        "roe": fundamentals.get("roe"),
        "roce": fundamentals.get("roce"),
        "debt_to_equity": fundamentals.get("debt_to_equity"),
        "net_margin": fundamentals.get("net_margin"),
        "dividend_yield": fundamentals.get("dividend_yield"),
        "eps": fundamentals.get("eps"),
        "net_profit_cr": fundamentals.get("net_profit_cr"),
    }


# ── GET / (health) ───────────────────────────────────────────────────────────

@router.get("/")
def ai_health():
    return {"message": "AI router ready"}


# ── POST /parse-query ─────────────────────────────────────────────────────────

@router.post("/parse-query")
async def parse_query(req: ParseQueryRequest):
    query_hash = hashlib.sha256(req.query.lower().strip().encode()).hexdigest()[:16]
    cache_key = f"nl_query:{query_hash}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    raw = await ai_service.parse_natural_language_query(req.query)
    validated = ai_service.validate_filter_output(raw)
    set_cache(cache_key, validated, ex=3600)
    return validated


# ── POST /explain-stock ───────────────────────────────────────────────────────

@router.post("/explain-stock")
async def explain_stock(req: ExplainRequest):
    data = _fetch_stock_with_fundamentals(req.symbol)
    stream = ai_service.stream_stock_explanation(
        req.symbol.upper(),
        req.investment_style,
        data,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /compare ────────────────────────────────────────────────────────────

@router.post("/compare")
async def compare_ai(req: CompareRequest):
    data_a = _fetch_stock_with_fundamentals(req.symbol_a)
    data_b = _fetch_stock_with_fundamentals(req.symbol_b)
    stream = ai_service.stream_comparison(
        req.symbol_a.upper(),
        req.symbol_b.upper(),
        req.investment_style,
        data_a,
        data_b,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )