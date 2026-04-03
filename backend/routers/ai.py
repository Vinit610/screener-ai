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


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _try_fetch_stock(symbol: str) -> dict | None:
    """Try to fetch stock + fundamentals. Returns None if not found (no exception)."""
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
        return None
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


# ── POST /chat ────────────────────────────────────────────────────────────────

@router.post("/chat")
async def chat(req: ChatRequest):
    """Smart chat endpoint — classifies intent and routes to appropriate handler.

    Returns SSE stream with events:
      - {"type": "intent", "intent": "filter|stock_query|general", "symbol": "..."}
      - {"type": "filters", "data": {...}}           (for filter intent)
      - {"type": "token", "text": "..."}              (streaming text)
      - {"type": "done"}
    """
    import json as _json

    # Step 1: Classify intent
    classification = await ai_service.classify_chat_intent(req.message)
    intent = classification.get("intent", "general")
    symbol = classification.get("symbol")

    async def _generate():
        # Send intent classification first
        yield f"data: {_json.dumps({'type': 'intent', 'intent': intent, 'symbol': symbol})}\n\n"

        if intent == "filter":
            # Parse filters from the query
            raw = await ai_service.parse_natural_language_query(req.message)
            validated = ai_service.validate_filter_output(raw)

            if validated:
                yield f"data: {_json.dumps({'type': 'filters', 'data': validated})}\n\n"
                yield f"data: {_json.dumps({'type': 'done'})}\n\n"
            else:
                # Couldn't parse filters, stream a helpful response instead
                async for event in ai_service.stream_general_chat(req.message):
                    yield event

        elif intent == "stock_query" and symbol:
            stock_data = _try_fetch_stock(symbol)
            if stock_data:
                async for event in ai_service.stream_stock_chat(
                    symbol, req.message, stock_data
                ):
                    yield event
            else:
                # Symbol not found in DB — fall back to general chat
                yield f"data: {_json.dumps({'token': f'I could not find {symbol} in the database. '})}\n\n"
                async for event in ai_service.stream_general_chat(req.message):
                    yield event

        else:
            # General chat
            async for event in ai_service.stream_general_chat(req.message):
                yield event

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )