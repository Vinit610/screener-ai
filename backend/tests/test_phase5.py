"""
Phase 5 tests — Screener API

Tests cover:
- Business logic helpers (cache key, rolling returns, Sharpe ratio)
- Endpoint contract tests with mocked Supabase + Redis (no real DB needed)
"""
from __future__ import annotations

import sys
import os
from unittest.mock import MagicMock, patch

import pytest
from contextlib import ExitStack

# ── Ensure backend package is importable ─────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ═════════════════════════════════════════════════════════════════════════════
# Helper unit-tests (no FastAPI, no DB)
# ═════════════════════════════════════════════════════════════════════════════

# Per-fund return / Sharpe / Sortino / drawdown maths now lives in the pipeline
# (pipeline/mf_metrics.py) and is unit-tested there — the backend just reads the
# precomputed mf_metrics rows.


class TestCacheKeyStability:
    """Cache key must be identical for the same params, different for different params."""

    def test_same_params_same_key(self):
        from routers.stocks import _build_screen_cache_key
        k1 = _build_screen_cache_key(sector="IT", min_pe=10.0, page=1, limit=50)
        k2 = _build_screen_cache_key(sector="IT", min_pe=10.0, page=1, limit=50)
        assert k1 == k2

    def test_different_params_different_key(self):
        from routers.stocks import _build_screen_cache_key
        k1 = _build_screen_cache_key(sector="IT", page=1, limit=50)
        k2 = _build_screen_cache_key(sector="Banking", page=1, limit=50)
        assert k1 != k2

    def test_none_params_excluded(self):
        from routers.stocks import _build_screen_cache_key
        k1 = _build_screen_cache_key(sector="IT", min_pe=None, page=1)
        k2 = _build_screen_cache_key(sector="IT", page=1)
        assert k1 == k2


class TestMarketCapRanges:
    def test_large_cap_lower_bound(self):
        from routers.stocks import MARKET_CAP_RANGES
        min_mc, max_mc = MARKET_CAP_RANGES["large"]
        assert min_mc == 20_000.0
        assert max_mc is None

    def test_micro_cap_upper_bound(self):
        from routers.stocks import MARKET_CAP_RANGES
        min_mc, max_mc = MARKET_CAP_RANGES["micro"]
        assert min_mc is None
        assert max_mc == 500.0

    def test_mid_cap_range(self):
        from routers.stocks import MARKET_CAP_RANGES
        min_mc, max_mc = MARKET_CAP_RANGES["mid"]
        assert min_mc == 5_000.0
        assert max_mc == 20_000.0


# ═════════════════════════════════════════════════════════════════════════════
# Endpoint contract tests (mocked DB + cache)
# ═════════════════════════════════════════════════════════════════════════════

# Minimal seed data matching the schema
_STOCK_ROW = {
    "id": "aaaa-1111",
    "symbol": "INFY",
    "exchange": "NSE",
    "name": "Infosys Limited",
    "sector": "IT",
    "industry": "IT Services",
    "market_cap_cr": 650000.0,
    "nse_listed": True,
    "is_active": True,
    "updated_at": "2024-01-01T00:00:00",
}

_FUND_ROW = {
    "stock_id": "aaaa-1111",
    "pe": 25.5,
    "pb": 7.2,
    "roe": 28.5,
    "roce": 35.2,
    "debt_to_equity": 0.1,
    "net_margin": 18.5,
    "operating_margin": 22.1,
    "revenue_cr": 150000.0,
    "net_profit_cr": 27000.0,
    "eps": 65.5,
    "dividend_yield": 2.8,
    "book_value": 180.5,
    "graham_number": None,
    "scraped_at": "2024-01-01T00:00:00",
}

_MF_ROW = {
    "id": "bbbb-2222",
    "scheme_code": "118989",
    "scheme_name": "HDFC Top 100 Fund",
    "fund_house": "HDFC Mutual Fund",
    "category": "Equity",
    "sub_category": "Large Cap",
    "expense_ratio": 0.5,
    "aum_cr": 25000.0,
    "benchmark": None,
    "is_direct": True,
    "is_growth": True,
    "is_active": True,
    "updated_at": "2024-01-01T00:00:00",
}


def _mock_supabase_chain(return_data, count=None):
    """
    Build a mock supabase chain where .execute() returns a mock response
    with .data and .count attributes.
    """
    response = MagicMock()
    response.data = return_data
    if count is not None:
        response.count = count
    elif return_data is None:
        response.count = 0
    else:
        response.count = len(return_data)

    chain = MagicMock()
    # All builder methods return themselves so we can chain
    for method in [
        "select", "eq", "neq", "gte", "lte", "gt", "lt", "in_", "contains",
        "ilike", "order", "range", "limit", "single", "maybe_single",
    ]:
        getattr(chain, method).return_value = chain
    chain.execute.return_value = response
    return chain


@pytest.fixture
def client():
    """TestClient with Supabase and cache mocked out."""
    from fastapi.testclient import TestClient

    mock_db = MagicMock()
    mock_db.table.return_value = _mock_supabase_chain([], count=0)

    # Patch supabase at each router's module level so that `from database import
    # supabase` references are replaced, not just the database module attribute.
    router_patches = [
        patch("routers.stocks.supabase", mock_db),
        patch("routers.mf.supabase", mock_db),
        patch("routers.compare.supabase", mock_db),
    ]
    cache_patches = [
        patch("cache.get_cache", return_value=None),
        patch("cache.set_cache", return_value=True),
    ]

    with ExitStack() as stack:
        for p in router_patches + cache_patches:
            stack.enter_context(p)
        from main import app
        yield TestClient(app), mock_db


class TestHealthEndpoint:
    def test_health(self, client):
        tc, _ = client
        resp = tc.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestScreenEndpoint:
    def test_screen_returns_paginated_structure(self, client):
        tc, mock_db = client

        stock_with_fund = {**_STOCK_ROW, "fundamentals": _FUND_ROW}
        mock_db.table.return_value = _mock_supabase_chain([_STOCK_ROW], count=1)

        with patch("routers.stocks._fetch_fundamentals_for_stocks", return_value={"aaaa-1111": _FUND_ROW}):
            resp = tc.get("/api/stocks/screen")

        assert resp.status_code == 200
        body = resp.json()
        assert "data" in body
        assert "total" in body
        assert "page" in body
        assert "limit" in body

    def test_screen_invalid_limit_rejected(self, client):
        tc, _ = client
        resp = tc.get("/api/stocks/screen?limit=999")
        assert resp.status_code == 422  # FastAPI validation error

    def test_screen_page_must_be_positive(self, client):
        tc, _ = client
        resp = tc.get("/api/stocks/screen?page=0")
        assert resp.status_code == 422

    def test_screen_returns_empty_when_no_fundamentals_match(self, client):
        tc, mock_db = client

        # Fundamentals query returns empty → should short-circuit
        mock_db.table.return_value = _mock_supabase_chain([], count=0)

        resp = tc.get("/api/stocks/screen?min_roe=999")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 0
        assert body["data"] == []


class TestStockDetailEndpoint:
    def test_stock_not_found_returns_404(self, client):
        tc, mock_db = client
        mock_db.table.return_value = _mock_supabase_chain(None)

        resp = tc.get("/api/stocks/XXXXXX")
        assert resp.status_code == 404

    def test_stock_detail_structure(self, client):
        tc, mock_db = client

        # Simulate different table() calls returning appropriate data
        def _table_side_effect(name):
            if name == "stocks":
                chain = _mock_supabase_chain(_STOCK_ROW, count=1)
                chain.execute.return_value.data = _STOCK_ROW
                return chain
            if name == "stock_fundamentals":
                chain = _mock_supabase_chain(_FUND_ROW, count=1)
                chain.execute.return_value.data = _FUND_ROW
                return chain
            # stock_prices
            return _mock_supabase_chain([], count=0)

        mock_db.table.side_effect = _table_side_effect

        resp = tc.get("/api/stocks/INFY")
        assert resp.status_code == 200
        body = resp.json()
        assert body["symbol"] == "INFY"
        assert "price_history" in body


class TestStockNewsEndpoint:
    def test_news_returns_correct_structure(self, client):
        tc, mock_db = client
        mock_db.table.return_value = _mock_supabase_chain([], count=0)

        resp = tc.get("/api/stocks/INFY/news")
        assert resp.status_code == 200
        body = resp.json()
        assert "data" in body
        assert "total" in body


class TestMFScreenEndpoint:
    def test_mf_screen_returns_paginated_structure(self, client):
        tc, mock_db = client
        mock_db.table.return_value = _mock_supabase_chain([_MF_ROW], count=1)

        resp = tc.get("/api/mf/screen")
        assert resp.status_code == 200
        body = resp.json()
        assert "data" in body
        assert body["total"] == 1
        assert body["page"] == 1

    def test_mf_screen_filters_applied(self, client):
        tc, mock_db = client
        mock_db.table.return_value = _mock_supabase_chain([], count=0)

        resp = tc.get("/api/mf/screen?max_expense_ratio=0.3&category=Equity")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


class TestMFDetailEndpoint:
    def test_mf_not_found_returns_404(self, client):
        tc, mock_db = client
        mock_db.table.return_value = _mock_supabase_chain(None)

        resp = tc.get("/api/mf/NONEXISTENT")
        assert resp.status_code == 404

    def test_mf_detail_includes_metrics_and_nav_history(self, client):
        tc, mock_db = client

        def _table_side_effect(name):
            if name == "mutual_funds":
                chain = _mock_supabase_chain(_MF_ROW, count=1)
                chain.execute.return_value.data = _MF_ROW
                return chain
            # mf_navs / mf_metrics — empty for this contract test
            return _mock_supabase_chain([], count=0)

        mock_db.table.side_effect = _table_side_effect

        resp = tc.get("/api/mf/118989")
        assert resp.status_code == 200
        body = resp.json()
        assert "metrics" in body
        assert "nav_history" in body


class TestCompareEndpoint:
    def test_missing_params_returns_400(self, client):
        tc, _ = client
        resp = tc.get("/api/compare/")
        assert resp.status_code == 400

    def test_mixed_params_returns_400(self, client):
        tc, _ = client
        resp = tc.get("/api/compare/?symbol_a=INFY&scheme_code_b=118989")
        assert resp.status_code == 400

    def test_stock_compare_structure(self, client):
        tc, mock_db = client

        def _table_side_effect(name):
            if name == "stocks":
                chain = _mock_supabase_chain(_STOCK_ROW, count=1)
                chain.execute.return_value.data = _STOCK_ROW
                return chain
            if name == "stock_fundamentals":
                chain = _mock_supabase_chain(_FUND_ROW, count=1)
                chain.execute.return_value.data = _FUND_ROW
                return chain
            return _mock_supabase_chain([], count=0)

        mock_db.table.side_effect = _table_side_effect

        resp = tc.get("/api/compare/?symbol_a=INFY&symbol_b=TCS")
        assert resp.status_code == 200
        body = resp.json()
        assert body["type"] == "stocks"
        assert "instrument_a" in body
        assert "instrument_b" in body

    def test_mf_compare_structure(self, client):
        tc, mock_db = client

        def _table_side_effect(name):
            if name == "mutual_funds":
                chain = _mock_supabase_chain(_MF_ROW, count=1)
                chain.execute.return_value.data = _MF_ROW
                return chain
            return _mock_supabase_chain([], count=0)

        mock_db.table.side_effect = _table_side_effect

        resp = tc.get("/api/compare/?scheme_code_a=118989&scheme_code_b=120644")
        assert resp.status_code == 200
        body = resp.json()
        assert body["type"] == "mf"
