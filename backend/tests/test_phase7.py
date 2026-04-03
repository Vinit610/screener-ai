"""
Phase 7 tests — AI Layer

Tests cover:
- validate_filter_output (unit tests, no Gemini needed)
- POST /api/ai/parse-query (mocked Gemini)
- POST /api/ai/explain-stock (mocked Gemini + Supabase)
- POST /api/ai/compare (mocked Gemini + Supabase)
"""
from __future__ import annotations

import json
import sys
import os
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

# Ensure backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ═══════════════════════════════════════════════════════════════════════════════
# Unit tests — validate_filter_output (no network calls)
# ═══════════════════════════════════════════════════════════════════════════════

class TestValidateFilterOutput:
    def _validate(self, raw: dict) -> dict:
        from services.ai_service import validate_filter_output
        return validate_filter_output(raw)

    def test_passes_valid_filters(self):
        raw = {
            "market_cap_category": "small",
            "exclude_loss_making": True,
            "max_debt_to_equity": 0.5,
        }
        assert self._validate(raw) == raw

    def test_strips_unknown_keys(self):
        raw = {"sector": "IT", "hallucinated_key": 42, "foo": "bar"}
        assert self._validate(raw) == {"sector": "IT"}

    def test_strips_invalid_sector(self):
        raw = {"sector": "Healthcare"}
        assert self._validate(raw) == {}

    def test_strips_invalid_market_cap(self):
        raw = {"market_cap_category": "giant"}
        assert self._validate(raw) == {}

    def test_strips_non_bool_exclude(self):
        raw = {"exclude_loss_making": "yes"}
        assert self._validate(raw) == {}

    def test_strips_non_numeric_min_max(self):
        raw = {"min_pe": "low", "max_pe": 30}
        assert self._validate(raw) == {"max_pe": 30}

    def test_returns_empty_for_empty(self):
        assert self._validate({}) == {}

    def test_all_valid_sectors_pass(self):
        from services.ai_service import VALID_SECTORS
        for sector in VALID_SECTORS:
            assert self._validate({"sector": sector}) == {"sector": sector}

    def test_all_valid_cap_categories_pass(self):
        from services.ai_service import VALID_MARKET_CAP_CATEGORIES
        for cat in VALID_MARKET_CAP_CATEGORIES:
            assert self._validate({"market_cap_category": cat}) == {"market_cap_category": cat}

    def test_int_values_accepted_for_numerics(self):
        raw = {"min_roe": 15, "max_pe": 20}
        assert self._validate(raw) == {"min_roe": 15, "max_pe": 20}


# ═══════════════════════════════════════════════════════════════════════════════
# Integration tests — FastAPI endpoints (mocked Gemini + Supabase)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture()
def client():
    """Create a TestClient with mocked Supabase and Redis."""
    # Mock config before importing modules
    mock_settings = MagicMock()
    mock_settings.supabase_url = "https://test.supabase.co"
    mock_settings.supabase_service_role_key = "test-key"
    mock_settings.upstash_redis_rest_url = "https://test.upstash.io"
    mock_settings.upstash_redis_rest_token = "test-token"
    mock_settings.gemini_api_key = "test-gemini-key"
    mock_settings.allowed_origins = "http://localhost:3000"

    with patch.dict(os.environ, {
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "test-key",
        "UPSTASH_REDIS_REST_URL": "https://test.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "test-token",
        "GEMINI_API_KEY": "test-gemini-key",
        "ALLOWED_ORIGINS": "http://localhost:3000",
    }):
        # Patch at module level before import
        with patch("config.settings", mock_settings):
            with patch("database.supabase") as mock_supabase:
                with patch("cache.get_cache", return_value=None):
                    with patch("cache.set_cache", return_value=True):
                        from fastapi.testclient import TestClient
                        # Need to reimport main to pick up mocked dependencies
                        import importlib
                        import main as main_mod
                        importlib.reload(main_mod)
                        yield TestClient(main_mod.app)


class TestParseQueryEndpoint:
    """Test POST /api/ai/parse-query with mocked Gemini."""

    def test_returns_filters(self, client):
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "sector": "IT",
            "min_roe": 15,
            "max_pe": 20,
        })
        with patch("services.ai_service.client") as mock_genai:
            mock_genai.models.generate_content.return_value = mock_response
            resp = client.post(
                "/api/ai/parse-query",
                json={"query": "IT stocks with high ROE and low PE"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["sector"] == "IT"
        assert data["min_roe"] == 15

    def test_returns_empty_for_gibberish(self, client):
        mock_response = MagicMock()
        mock_response.text = "{}"
        with patch("services.ai_service.client") as mock_genai:
            mock_genai.models.generate_content.return_value = mock_response
            resp = client.post(
                "/api/ai/parse-query",
                json={"query": "asdfghjkl"},
            )
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_rejects_empty_query(self, client):
        resp = client.post("/api/ai/parse-query", json={"query": ""})
        assert resp.status_code == 422

    def test_strips_invalid_keys_from_gemini(self, client):
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "sector": "IT",
            "made_up_filter": 42,
        })
        with patch("services.ai_service.client") as mock_genai:
            mock_genai.models.generate_content.return_value = mock_response
            resp = client.post(
                "/api/ai/parse-query",
                json={"query": "IT stocks"},
            )
        data = resp.json()
        assert "sector" in data
        assert "made_up_filter" not in data


class TestExplainStockEndpoint:
    """Test POST /api/ai/explain-stock with mocked data."""

    def test_returns_sse_stream(self, client):
        mock_stock_resp = MagicMock()
        mock_stock_resp.data = {
            "id": "abc",
            "symbol": "INFY",
            "name": "Infosys",
            "sector": "IT",
            "market_cap_cr": 500000,
        }
        mock_fund_resp = MagicMock()
        mock_fund_resp.data = {
            "pe": 22,
            "pb": 6,
            "roe": 30,
            "roce": 38,
            "debt_to_equity": 0.1,
            "net_margin": 20,
            "dividend_yield": 2.5,
            "eps": 55,
            "net_profit_cr": 22000,
        }

        # Build chained Supabase mock
        mock_table = MagicMock()
        mock_select = MagicMock()
        mock_eq1 = MagicMock()
        mock_eq2 = MagicMock()

        def table_side_effect(name):
            m = MagicMock()
            if name == "stocks":
                m.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = mock_stock_resp
            else:
                m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = mock_fund_resp
            return m

        # Mock Gemini streaming
        chunk = MagicMock()
        chunk.text = "This stock looks good."

        with patch("routers.ai.supabase") as mock_db:
            mock_db.table.side_effect = table_side_effect
            with patch("services.ai_service.client") as mock_genai:
                mock_genai.models.generate_content_stream.return_value = [chunk]
                resp = client.post(
                    "/api/ai/explain-stock",
                    json={"symbol": "INFY"},
                )

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        body = resp.text
        assert "data:" in body

    def test_returns_404_for_unknown_stock(self, client):
        mock_resp = MagicMock()
        mock_resp.data = None

        with patch("routers.ai.supabase") as mock_db:
            m = MagicMock()
            m.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = mock_resp
            mock_db.table.return_value = m
            resp = client.post(
                "/api/ai/explain-stock",
                json={"symbol": "ZZZZZ"},
            )
        assert resp.status_code == 404


class TestCompareEndpoint:
    """Test POST /api/ai/compare with mocked data."""

    def test_returns_sse_stream(self, client):
        def make_stock_data(symbol, name):
            mock_stock = MagicMock()
            mock_stock.data = {
                "id": f"id-{symbol}",
                "symbol": symbol,
                "name": name,
                "sector": "IT",
                "market_cap_cr": 500000,
            }
            mock_fund = MagicMock()
            mock_fund.data = {
                "pe": 22, "pb": 6, "roe": 30, "roce": 38,
                "debt_to_equity": 0.1, "net_margin": 20,
                "dividend_yield": 2.5, "eps": 55, "net_profit_cr": 22000,
            }
            return mock_stock, mock_fund

        stock_a, fund_a = make_stock_data("INFY", "Infosys")
        stock_b, fund_b = make_stock_data("TCS", "TCS")

        call_count = {"stocks": 0, "fundamentals": 0}

        def table_side_effect(name):
            m = MagicMock()
            if name == "stocks":
                resp = stock_a if call_count["stocks"] == 0 else stock_b
                call_count["stocks"] += 1
                m.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = resp
            else:
                resp = fund_a if call_count["fundamentals"] == 0 else fund_b
                call_count["fundamentals"] += 1
                m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = resp
            return m

        chunk = MagicMock()
        chunk.text = '{"overall_winner": "INFY"}\nInfosys has better margins.'

        with patch("routers.ai.supabase") as mock_db:
            mock_db.table.side_effect = table_side_effect
            with patch("services.ai_service.client") as mock_genai:
                mock_genai.models.generate_content_stream.return_value = [chunk]
                resp = client.post(
                    "/api/ai/compare",
                    json={"symbol_a": "INFY", "symbol_b": "TCS"},
                )

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")


# ═══════════════════════════════════════════════════════════════════════════════
# NL Query edge-case tests (mocked Gemini for various query styles)
# ═══════════════════════════════════════════════════════════════════════════════

class TestNLQueryEdgeCases:
    """Test that various NL queries return valid filters via mocked Gemini."""

    QUERIES_AND_EXPECTED = [
        ("profitable small-caps with low debt", {"market_cap_category": "small", "exclude_loss_making": True, "max_debt_to_equity": 0.5}),
        ("dividend paying pharma stocks", {"sector": "Pharma", "min_dividend_yield": 2}),
        ("undervalued banking stocks", {"sector": "Banking", "max_pe": 15}),
        ("blue chip stocks", {"market_cap_category": "large"}),
        ("high ROE IT companies", {"sector": "IT", "min_roe": 15}),
    ]

    @pytest.mark.parametrize("query,expected", QUERIES_AND_EXPECTED)
    def test_nl_queries(self, client, query, expected):
        mock_response = MagicMock()
        mock_response.text = json.dumps(expected)
        with patch("services.ai_service.client") as mock_genai:
            mock_genai.models.generate_content.return_value = mock_response
            resp = client.post(
                "/api/ai/parse-query",
                json={"query": query},
            )
        assert resp.status_code == 200
        data = resp.json()
        for key, val in expected.items():
            assert data.get(key) == val
