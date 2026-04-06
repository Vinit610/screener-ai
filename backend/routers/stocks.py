"""
Stock screener endpoints.

GET /api/stocks/screen  — filtered, paginated stock list with fundamentals
GET /api/stocks/{symbol} — full detail including up to 365 days of prices
GET /api/stocks/{symbol}/news — latest 20 news articles for a symbol
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from cache import get_cache, set_cache
from database import supabase
from schemas.stock_schemas import ScreenerResponse, StockDetailResponse, NewsResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# Market-cap category → (min_crore, max_crore).  max=None means no upper bound.
MARKET_CAP_RANGES: dict[str, tuple[Optional[float], Optional[float]]] = {
    "large": (20_000.0, None),
    "mid": (5_000.0, 20_000.0),
    "small": (500.0, 5_000.0),
    "micro": (None, 500.0),
}

# Columns that exist on the `stocks` table (can be sorted in the DB query)
_STOCKS_SORT_FIELDS = {"market_cap_cr", "symbol", "name", "sector", "updated_at"}

# Columns that exist on `stock_fundamentals` (sorted in Python after merge)
_FUND_SORT_FIELDS = {
    "pe", "pb", "roe", "roce", "debt_to_equity",
    "net_margin", "dividend_yield", "eps", "revenue_cr", "net_profit_cr",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_screen_cache_key(**kwargs) -> str:
    """Stable cache key from filter + pagination params."""
    relevant = {k: v for k, v in kwargs.items() if v is not None and v is not False}
    return f"screen:{hash(frozenset(relevant.items()))}"


def _fetch_fundamentals_for_stocks(stock_ids: list[str]) -> dict[str, dict]:
    """Batch-fetch fundamentals and return a {stock_id: row} mapping."""
    if not stock_ids:
        return {}
    resp = (
        supabase.table("stock_fundamentals")
        .select(
            "stock_id,pe,pb,roe,roce,debt_to_equity,net_margin,"
            "operating_margin,revenue_cr,net_profit_cr,eps,"
            "dividend_yield,book_value,graham_number,scraped_at"
        )
        .in_("stock_id", stock_ids)
        .execute()
    )
    return {row["stock_id"]: row for row in (resp.data or [])}


# ── GET /screen ───────────────────────────────────────────────────────────────

@router.get("/screen", response_model=ScreenerResponse)
def screen_stocks(
    market_cap_category: Optional[str] = Query(None, description="large|mid|small|micro"),
    min_pe: Optional[float] = Query(None),
    max_pe: Optional[float] = Query(None),
    min_pb: Optional[float] = Query(None),
    max_pb: Optional[float] = Query(None),
    min_roe: Optional[float] = Query(None),
    max_roe: Optional[float] = Query(None),
    min_roce: Optional[float] = Query(None),
    max_roce: Optional[float] = Query(None),
    max_debt_to_equity: Optional[float] = Query(None),
    min_net_margin: Optional[float] = Query(None),
    min_dividend_yield: Optional[float] = Query(None),
    sector: Optional[str] = Query(None),
    exclude_loss_making: bool = Query(False),
    sort_by: str = Query("market_cap_cr"),
    sort_dir: str = Query("desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    # ── Cache check ──────────────────────────────────────────────────────────
    cache_key = _build_screen_cache_key(
        market_cap_category=market_cap_category,
        min_pe=min_pe, max_pe=max_pe,
        min_pb=min_pb, max_pb=max_pb,
        min_roe=min_roe, max_roe=max_roe,
        min_roce=min_roce, max_roce=max_roce,
        max_debt_to_equity=max_debt_to_equity,
        min_net_margin=min_net_margin,
        min_dividend_yield=min_dividend_yield,
        sector=sector,
        exclude_loss_making=exclude_loss_making,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        limit=limit,
    )
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    # ── Determine whether any fundamentals filters are active ────────────────
    has_fund_filter = any(
        v is not None for v in [
            min_pe, max_pe, min_pb, max_pb, min_roe, max_roe,
            min_roce, max_roce, max_debt_to_equity, min_net_margin,
            min_dividend_yield,
        ]
    ) or exclude_loss_making

    fund_map: dict[str, dict] = {}
    matching_stock_ids: Optional[list[str]] = None

    if has_fund_filter:
        # Step 1: filter on stock_fundamentals to get qualifying stock_ids
        fq = supabase.table("stock_fundamentals").select(
            "stock_id,pe,pb,roe,roce,debt_to_equity,net_margin,"
            "operating_margin,revenue_cr,net_profit_cr,eps,"
            "dividend_yield,book_value,graham_number,scraped_at"
        )
        if min_pe is not None:
            fq = fq.gte("pe", min_pe)
        if max_pe is not None:
            fq = fq.lte("pe", max_pe)
        if min_pb is not None:
            fq = fq.gte("pb", min_pb)
        if max_pb is not None:
            fq = fq.lte("pb", max_pb)
        if min_roe is not None:
            fq = fq.gte("roe", min_roe)
        if max_roe is not None:
            fq = fq.lte("roe", max_roe)
        if min_roce is not None:
            fq = fq.gte("roce", min_roce)
        if max_roce is not None:
            fq = fq.lte("roce", max_roce)
        if max_debt_to_equity is not None:
            fq = fq.lte("debt_to_equity", max_debt_to_equity)
        if min_net_margin is not None:
            fq = fq.gte("net_margin", min_net_margin)
        if min_dividend_yield is not None:
            fq = fq.gte("dividend_yield", min_dividend_yield)
        if exclude_loss_making:
            fq = fq.gt("net_profit_cr", 0)

        fund_resp = fq.execute()
        fund_data = fund_resp.data or []
        fund_map = {row["stock_id"]: row for row in fund_data}
        matching_stock_ids = list(fund_map.keys())

        if not matching_stock_ids:
            result = {"data": [], "total": 0, "page": page, "limit": limit}
            set_cache(cache_key, result, ex=1800)
            return result

    # ── Step 2: query stocks table ───────────────────────────────────────────
    # Decide whether to sort in DB or in Python
    sort_in_db = sort_by in _STOCKS_SORT_FIELDS

    sq = supabase.table("stocks").select("*", count="exact").eq("is_active", True)

    if matching_stock_ids is not None:
        sq = sq.in_("id", matching_stock_ids)

    if market_cap_category:
        cat = market_cap_category.lower()
        if cat in MARKET_CAP_RANGES:
            min_mc, max_mc = MARKET_CAP_RANGES[cat]
            if min_mc is not None:
                sq = sq.gte("market_cap_cr", min_mc)
            if max_mc is not None:
                sq = sq.lt("market_cap_cr", max_mc)

    if sector:
        sq = sq.eq("sector", sector)

    if sort_in_db:
        start = (page - 1) * limit
        sq = sq.order(sort_by, desc=(sort_dir == "desc")).range(start, start + limit - 1)
        stocks_resp = sq.execute()
        stocks_data = stocks_resp.data or []
        total = stocks_resp.count or 0

        # Enrich with fundamentals (batch-fetch only the page we need)
        if not has_fund_filter:
            fund_map = _fetch_fundamentals_for_stocks([s["id"] for s in stocks_data])

        for stock in stocks_data:
            stock["fundamentals"] = fund_map.get(stock["id"])

        result = {"data": stocks_data, "total": total, "page": page, "limit": limit}
    else:
        # Sort field is on fundamentals — fetch all matching stocks then sort in Python
        stocks_resp = sq.execute()
        all_stocks = stocks_resp.data or []
        total = len(all_stocks)

        if not has_fund_filter:
            fund_map = _fetch_fundamentals_for_stocks([s["id"] for s in all_stocks])

        for stock in all_stocks:
            stock["fundamentals"] = fund_map.get(stock["id"])

        def _sort_key(s: dict):
            fund = s.get("fundamentals") or {}
            val = fund.get(sort_by)
            if val is None:
                return float("inf") if sort_dir == "desc" else float("-inf")
            return val

        all_stocks.sort(key=_sort_key, reverse=(sort_dir == "desc"))
        start = (page - 1) * limit
        data = all_stocks[start: start + limit]
        result = {"data": data, "total": total, "page": page, "limit": limit}

    set_cache(cache_key, result, ex=1800)
    return result


# ── GET /{symbol}/analysis ────────────────────────────────────────────────────

@router.get("/{symbol}/analysis")
def get_stock_analysis(symbol: str):
    """Return the latest AI-generated analysis for a stock."""
    symbol = symbol.upper()
    cache_key = f"stock_analysis:{symbol}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    # Look up the stock
    stock_resp = (
        supabase.table("stocks")
        .select("id")
        .eq("symbol", symbol)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if not stock_resp.data:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found")

    stock_id = stock_resp.data["id"]

    # Fetch the analysis
    analysis_resp = (
        supabase.table("stock_ai_analyses")
        .select("analysis_json,overall_score,generated_at,prompt_version,"
                "score_1d_ago,score_7d_ago,score_30d_ago")
        .eq("stock_id", stock_id)
        .maybe_single()
        .execute()
    )

    if not analysis_resp.data:
        raise HTTPException(status_code=404, detail=f"No AI analysis available for '{symbol}'")

    result = {
        "symbol": symbol,
        **analysis_resp.data,
    }
    set_cache(cache_key, result, ex=3600)  # 1 hour cache
    return result


# ── GET /{symbol} ─────────────────────────────────────────────────────────────

@router.get("/{symbol}", response_model=StockDetailResponse)
def get_stock(symbol: str):
    cache_key = f"stock_detail:{symbol.upper()}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    symbol = symbol.upper()

    # Fetch stock row
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

    # Fetch fundamentals
    fund_resp = (
        supabase.table("stock_fundamentals")
        .select("*")
        .eq("stock_id", stock["id"])
        .maybe_single()
        .execute()
    )
    stock["fundamentals"] = fund_resp.data

    # Fetch last 5 years of prices (ordered ascending for chart)
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=365 * 5)).isoformat()
    prices_resp = (
        supabase.table("stock_prices")
        .select("date,open,high,low,close,volume")
        .eq("stock_id", stock["id"])
        .gte("date", cutoff)
        .order("date", desc=False)
        .limit(2000)
        .execute()
    )
    price_rows = prices_resp.data or []

    stock["price_history"] = price_rows
    stock["latest_price"] = price_rows[-1] if price_rows else None

    set_cache(cache_key, stock, ex=1800)
    return stock


# ── GET /{symbol}/news ────────────────────────────────────────────────────────

@router.get("/{symbol}/news", response_model=NewsResponse)
def get_stock_news(symbol: str):
    symbol = symbol.upper()
    cache_key = f"stock_news:{symbol}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    news_resp = (
        supabase.table("news")
        .select(
            "id,headline,summary,url,source,published_at,"
            "sentiment,sentiment_score,related_symbols"
        )
        .contains("related_symbols", [symbol])
        .order("published_at", desc=True)
        .limit(20)
        .execute()
    )
    data = news_resp.data or []
    result = {"data": data, "total": len(data)}
    set_cache(cache_key, result, ex=900)  # 15 minutes
    return result
