"""
Mutual Fund screener and detail endpoints.

GET /api/mf/screen          — filtered, paginated MF list
GET /api/mf/{scheme_code}   — full detail + 365-day NAV history + rolling returns + Sharpe ratio
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from cache import get_cache, set_cache
from database import supabase
from schemas.stock_schemas import MFScreenerResponse, MFDetailResponse, RollingReturns

logger = logging.getLogger(__name__)
router = APIRouter()

_RISK_FREE_DAILY = 0.065 / 252  # 6.5% annualised → daily
_NAV_WINDOW_DAYS = 365 * 5 + 10  # fetch up to 5y so 3y returns have headroom
_NAV_PAGE_SIZE = 1000  # Supabase REST caps responses at 1000 rows; paginate.


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_navs(fund_id: str, cutoff_iso: str) -> list[dict]:
    """All NAVs for a fund within [cutoff_iso, today], sorted ASC, paginated.

    Supabase's REST layer caps a single response at 1000 rows. Without
    pagination an ASC query for a fund with >1000 daily NAVs silently drops
    the most recent rows, which manifests in the UI as an empty 1M/3M chart
    and stale 'most recent NAV' on longer windows.
    """
    all_rows: list[dict] = []
    start = 0
    while True:
        resp = (
            supabase.table("mf_navs")
            .select("date,nav")
            .eq("fund_id", fund_id)
            .gte("date", cutoff_iso)
            .order("date", desc=False)
            .range(start, start + _NAV_PAGE_SIZE - 1)
            .execute()
        )
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < _NAV_PAGE_SIZE:
            break
        start += _NAV_PAGE_SIZE
    return all_rows


def _get_fund_performance(fund_id: str) -> tuple[Optional[RollingReturns], Optional[float]]:
    """
    Fetch NAVs and compute trailing returns + sharpe ratio for a fund.
    Returns (RollingReturns, sharpe_ratio) or (None, None) if N/A.
    """
    try:
        cutoff = (date.today() - timedelta(days=_NAV_WINDOW_DAYS)).isoformat()
        nav_rows = _fetch_navs(fund_id, cutoff)

        if len(nav_rows) < 30:
            return (None, None)

        returns = RollingReturns(
            return_1m=_trailing_return(nav_rows, 30),
            return_3m=_trailing_return(nav_rows, 91),
            return_6m=_trailing_return(nav_rows, 182),
            return_1y=_trailing_return(nav_rows, 365),
            return_2y=_trailing_return(nav_rows, 730),
            return_3y=_trailing_return(nav_rows, 1095),
        )
        sharpe = _sharpe_ratio(nav_rows)
        return (returns, sharpe)
    except Exception as e:
        logger.debug(f"Failed to compute performance for fund_id {fund_id}: {e}")
        return (None, None)


def _trailing_return(navs: list[dict], calendar_days: int) -> Optional[float]:
    """
    (latest_nav - nav_on_or_after(today - N days)) / nav_on_or_after(...) * 100.

    Uses calendar-date lookup so the result is robust to holidays, weekends,
    and uneven NAV coverage. Returns None when no NAV exists at or before the
    target date (i.e. fund history is shorter than the requested window).

    navs must be sorted ascending by date.
    """
    if not navs:
        return None
    target_iso = (date.today() - timedelta(days=calendar_days)).isoformat()
    # Find the first NAV with date >= target_iso (binary search).
    lo, hi = 0, len(navs)
    while lo < hi:
        mid = (lo + hi) // 2
        if navs[mid]["date"] < target_iso:
            lo = mid + 1
        else:
            hi = mid
    if lo >= len(navs):
        return None
    nav_past = navs[lo]["nav"]
    nav_recent = navs[-1]["nav"]
    if not nav_past or nav_past == 0:
        return None
    if navs[lo]["date"] == navs[-1]["date"]:
        return None
    return round((nav_recent - nav_past) / nav_past * 100, 2)


def _sharpe_ratio(navs: list[dict]) -> Optional[float]:
    """
    Annualised Sharpe ratio from daily NAV returns.
    Sharpe = (mean_daily_return - risk_free_daily) / std_daily_return * sqrt(252)
    """
    if len(navs) < 30:
        return None

    daily_returns = []
    for i in range(1, len(navs)):
        prev = navs[i - 1]["nav"]
        curr = navs[i]["nav"]
        if prev > 0:
            daily_returns.append((curr - prev) / prev)

    if len(daily_returns) < 2:
        return None

    n = len(daily_returns)
    mean_r = sum(daily_returns) / n
    variance = sum((r - mean_r) ** 2 for r in daily_returns) / (n - 1)
    std_r = math.sqrt(variance)

    if std_r == 0:
        return None

    sharpe = (mean_r - _RISK_FREE_DAILY) / std_r * math.sqrt(252)
    return round(sharpe, 4)


# ── GET /screen ───────────────────────────────────────────────────────────────

@router.get("/screen", response_model=MFScreenerResponse)
def screen_mf(
    category: Optional[str] = Query(None, description='e.g. "Equity", "Debt"'),
    sub_category: Optional[str] = Query(None, description='e.g. "Large Cap", "ELSS"'),
    fund_house: Optional[str] = Query(None),
    max_expense_ratio: Optional[float] = Query(None),
    min_aum_cr: Optional[float] = Query(None),
    is_direct: Optional[bool] = Query(None),
    sort_by: str = Query("aum_cr"),
    sort_dir: str = Query("desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
):
    # Cache key
    params = {
        "category": category,
        "sub_category": sub_category,
        "fund_house": fund_house,
        "max_expense_ratio": max_expense_ratio,
        "min_aum_cr": min_aum_cr,
        "is_direct": is_direct,
        "sort_by": sort_by,
        "sort_dir": sort_dir,
        "page": page,
        "limit": limit,
    }
    relevant = {k: v for k, v in params.items() if v is not None}
    cache_key = f"mf_screen:{hash(frozenset(relevant.items()))}"

    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    sq = supabase.table("mutual_funds").select("*", count="exact").eq("is_active", True)

    if category:
        sq = sq.eq("category", category)
    if sub_category:
        sq = sq.eq("sub_category", sub_category)
    if fund_house:
        sq = sq.ilike("fund_house", f"%{fund_house}%")
    if max_expense_ratio is not None:
        sq = sq.lte("expense_ratio", max_expense_ratio)
    if min_aum_cr is not None:
        sq = sq.gte("aum_cr", min_aum_cr)
    if is_direct is not None:
        sq = sq.eq("is_direct", is_direct)

    start = (page - 1) * limit
    sq = sq.order(sort_by, desc=(sort_dir == "desc")).range(start, start + limit - 1)

    resp = sq.execute()
    data = resp.data or []
    total = resp.count or 0

    # Enrich each fund with performance metrics
    enriched_data = []
    for fund in data:
        returns, sharpe = _get_fund_performance(fund["id"])
        enriched_data.append({
            **fund,
            "returns": returns.model_dump() if returns else None,
            "sharpe_ratio": sharpe,
        })

    result = {"data": enriched_data, "total": total, "page": page, "limit": limit}
    set_cache(cache_key, result, ex=300)  # 5 minutes; NAVs only refresh daily
    return result


# ── GET /{scheme_code} ────────────────────────────────────────────────────────

@router.get("/{scheme_code}", response_model=MFDetailResponse)
def get_mf(scheme_code: str):
    cache_key = f"mf_detail:{scheme_code}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    # Fetch fund metadata
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

    # Fetch up to 5y of NAVs so the chart MAX range and 3Y return have headroom.
    cutoff = (date.today() - timedelta(days=_NAV_WINDOW_DAYS)).isoformat()
    nav_rows = _fetch_navs(fund["id"], cutoff)

    # Compute trailing returns
    returns = RollingReturns(
        return_1m=_trailing_return(nav_rows, 30),
        return_3m=_trailing_return(nav_rows, 91),
        return_6m=_trailing_return(nav_rows, 182),
        return_1y=_trailing_return(nav_rows, 365),
        return_2y=_trailing_return(nav_rows, 730),
        return_3y=_trailing_return(nav_rows, 1095),
    )

    # Sharpe ratio (uses full 3Y window)
    sharpe = _sharpe_ratio(nav_rows)

    # Return all available NAVs to frontend (need full 3Y for user timeframe selection)
    nav_history = nav_rows

    result = {
        **fund,
        "nav_history": nav_history,
        "returns": returns.model_dump(),
        "sharpe_ratio": sharpe,
    }
    set_cache(cache_key, result, ex=300)
    return result
