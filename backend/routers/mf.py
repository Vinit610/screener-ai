"""
Mutual Fund screener and detail endpoints.

GET /api/mf/screen          — filtered, paginated MF list + precomputed metrics
GET /api/mf/{scheme_code}   — full detail + 5y NAV history + precomputed metrics

Per-fund metrics (trailing returns, category rank, Sharpe/Sortino, max
drawdown) are precomputed nightly by pipeline/compute_mf_metrics.py into the
mf_metrics table — these endpoints just read them.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from cache import get_cache, set_cache
from database import supabase
from schemas.stock_schemas import MFScreenerResponse, MFDetailResponse

logger = logging.getLogger(__name__)
router = APIRouter()

_NAV_WINDOW_DAYS = 365 * 5 + 10  # serve up to 5y of NAVs for the chart
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


def _fetch_metrics_map(fund_ids: list[str]) -> dict[str, dict]:
    """Precomputed mf_metrics rows keyed by fund_id, for a set of funds."""
    if not fund_ids:
        return {}
    resp = (
        supabase.table("mf_metrics")
        .select("*")
        .in_("fund_id", fund_ids)
        .execute()
    )
    return {row["fund_id"]: row for row in (resp.data or [])}


# ── GET /screen ───────────────────────────────────────────────────────────────

@router.get("/screen", response_model=MFScreenerResponse)
def screen_mf(
    category: Optional[str] = Query(None, description='e.g. "Equity", "Debt"'),
    sub_category: Optional[str] = Query(None, description='e.g. "Large Cap", "ELSS"'),
    fund_house: Optional[str] = Query(None),
    max_expense_ratio: Optional[float] = Query(None),
    min_aum_cr: Optional[float] = Query(None),
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

    # The screener only surfaces Direct + Growth plans: one canonical row per
    # scheme (no 4x plan-variant duplication), cleanest NAV series, and the
    # right pick for a self-directed investor.
    sq = (
        supabase.table("mutual_funds")
        .select("*", count="exact")
        .eq("is_active", True)
        .eq("is_direct", True)
        .eq("is_growth", True)
    )

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

    start = (page - 1) * limit
    sq = sq.order(sort_by, desc=(sort_dir == "desc")).range(start, start + limit - 1)

    resp = sq.execute()
    data = resp.data or []
    total = resp.count or 0

    # Attach precomputed metrics in one batched lookup.
    metrics_map = _fetch_metrics_map([f["id"] for f in data])
    enriched_data = [
        {**fund, "metrics": metrics_map.get(fund["id"])}
        for fund in data
    ]

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

    # Serve up to 5y of NAVs so the chart MAX range has headroom.
    cutoff = (date.today() - timedelta(days=_NAV_WINDOW_DAYS)).isoformat()
    nav_history = _fetch_navs(fund["id"], cutoff)

    # Precomputed metrics (may be None until compute_mf_metrics.py has run).
    metrics = _fetch_metrics_map([fund["id"]]).get(fund["id"])

    result = {
        **fund,
        "nav_history": nav_history,
        "metrics": metrics,
    }
    set_cache(cache_key, result, ex=300)
    return result
