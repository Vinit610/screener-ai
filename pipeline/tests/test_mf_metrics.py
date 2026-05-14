"""Unit tests for the pure MF metric computations (pipeline/mf_metrics.py)."""
import os
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mf_metrics import (  # noqa: E402
    assign_ranks,
    max_drawdown,
    rolling_returns,
    sharpe_3y,
    sortino_3y,
    trailing_return,
)

TODAY = date(2026, 5, 1)


def _series(start_date: date, navs: list[float]) -> list[tuple[str, float]]:
    """Build a daily (date, nav) series starting at start_date."""
    return [
        ((start_date + timedelta(days=i)).isoformat(), v)
        for i, v in enumerate(navs)
    ]


# ── trailing_return ───────────────────────────────────────────────────────────

class TestTrailingReturn:
    def test_basic_growth(self):
        # 100 → 110 over the lookback window = +10%
        navs = [
            ((TODAY - timedelta(days=365)).isoformat(), 100.0),
            (TODAY.isoformat(), 110.0),
        ]
        assert trailing_return(navs, 365, today=TODAY) == pytest.approx(10.0)

    def test_negative_return(self):
        navs = [
            ((TODAY - timedelta(days=365)).isoformat(), 100.0),
            (TODAY.isoformat(), 80.0),
        ]
        assert trailing_return(navs, 365, today=TODAY) == pytest.approx(-20.0)

    def test_none_when_history_too_short(self):
        # Only ~1y of history — a 3y return must be None, not a mislabelled 1y.
        navs = _series(TODAY - timedelta(days=365), [100.0 + i for i in range(366)])
        assert trailing_return(navs, 3 * 365, today=TODAY) is None

    def test_uses_first_nav_on_or_after_target_within_tolerance(self):
        # Earliest NAV is 5 days after the 1y target — within tolerance, so it
        # is used as the 'past' anchor.
        start = TODAY - timedelta(days=360)
        navs = [(start.isoformat(), 200.0), (TODAY.isoformat(), 220.0)]
        assert trailing_return(navs, 365, today=TODAY) == pytest.approx(10.0)

    def test_none_for_single_point(self):
        assert trailing_return([(TODAY.isoformat(), 100.0)], 365, today=TODAY) is None


# ── sharpe / sortino ──────────────────────────────────────────────────────────

class TestSharpeSortino:
    def _three_years(self, daily_growth: float, noise=None):
        start = TODAY - timedelta(days=3 * 365 + 5)
        days = 3 * 365 + 6
        navs = []
        nav = 100.0
        for i in range(days):
            navs.append(((start + timedelta(days=i)).isoformat(), round(nav, 6)))
            bump = daily_growth
            if noise is not None:
                bump += noise[i % len(noise)]
            nav *= (1 + bump)
        return navs

    def test_none_when_under_3y_history(self):
        navs = _series(TODAY - timedelta(days=400), [100.0 + i for i in range(401)])
        assert sharpe_3y(navs, today=TODAY) is None
        assert sortino_3y(navs, today=TODAY) is None

    def test_steady_growth_positive_sharpe(self):
        navs = self._three_years(0.001)  # ~28.6% annualised, no volatility
        s = sharpe_3y(navs, today=TODAY)
        assert s is not None and s > 0

    def test_sortino_at_least_sharpe_for_mostly_upside(self):
        # A series with small symmetric noise: sortino >= sharpe because the
        # downside deviation is no larger than the full deviation.
        navs = self._three_years(0.0008, noise=[0.002, -0.001, 0.001, -0.0005])
        s = sharpe_3y(navs, today=TODAY)
        so = sortino_3y(navs, today=TODAY)
        assert s is not None and so is not None
        assert so >= s - 1e-6


# ── max_drawdown ──────────────────────────────────────────────────────────────

class TestMaxDrawdown:
    def test_simple_drawdown_and_recovery(self):
        # 100 → 120 (peak) → 60 (trough, -50%) → 130 (recovered)
        navs = _series(date(2020, 1, 1), [100, 120, 90, 60, 100, 130])
        dd = max_drawdown(navs)
        assert dd['max_drawdown'] == pytest.approx(-50.0)
        assert dd['max_drawdown_peak_date'] == "2020-01-02"   # nav 120
        assert dd['max_drawdown_trough_date'] == "2020-01-04"  # nav 60
        assert dd['max_drawdown_recovery_date'] == "2020-01-06"  # nav 130 >= 120

    def test_not_yet_recovered(self):
        navs = _series(date(2020, 1, 1), [100, 150, 90, 100, 120])
        dd = max_drawdown(navs)
        assert dd['max_drawdown'] == pytest.approx(-40.0)  # 150 → 90
        assert dd['max_drawdown_recovery_date'] is None

    def test_monotonic_increase_has_zero_drawdown(self):
        navs = _series(date(2020, 1, 1), [100, 101, 102, 103])
        dd = max_drawdown(navs)
        assert dd['max_drawdown'] == 0.0
        assert dd['max_drawdown_trough_date'] is None


# ── rolling_returns ───────────────────────────────────────────────────────────

class TestRollingReturns:
    def _steady(self, years: float, daily_growth: float):
        """A daily NAV series of `years` length growing at `daily_growth`/day."""
        days = int(years * 365) + 1
        navs = []
        nav = 100.0
        start = date(2018, 1, 1)
        for i in range(days):
            navs.append(((start + timedelta(days=i)).isoformat(), round(nav, 6)))
            nav *= (1 + daily_growth)
        return navs

    def test_none_when_history_too_short(self):
        # ~1.5y of data — not enough complete 1y windows for a sample.
        navs = self._steady(1.5, 0.0004)
        assert rolling_returns(navs, 1) is None

    def test_steady_series_has_tight_consistent_distribution(self):
        # 4y of perfectly steady growth → every 1y window annualises the same.
        navs = self._steady(4, 0.0005)
        r = rolling_returns(navs, 1)
        assert r is not None
        assert r['count'] >= 12
        assert r['min'] == pytest.approx(r['max'], abs=0.5)  # no spread
        assert r['avg'] > 0

    def test_pct_above_fd_full_when_returns_clear_bar(self):
        # ~20% annualised steady growth — every window beats the 6.5% FD bar.
        navs = self._steady(4, 0.0005)
        r = rolling_returns(navs, 1)
        assert r is not None and r['pct_above_fd'] == 100.0

    def test_pct_above_fd_zero_when_returns_below_bar(self):
        # ~3.7% annualised — below the 6.5% FD bar, so 0% of windows beat it.
        navs = self._steady(4, 0.0001)
        r = rolling_returns(navs, 1)
        assert r is not None and r['pct_above_fd'] == 0.0

    def test_three_year_window_needs_more_history(self):
        navs = self._steady(3.5, 0.0004)  # only 0.5y of room for 3y windows
        assert rolling_returns(navs, 3) is None
        navs_long = self._steady(5, 0.0004)  # 2y of room → enough windows
        assert rolling_returns(navs_long, 3) is not None


# ── assign_ranks ──────────────────────────────────────────────────────────────

class TestAssignRanks:
    def test_ranks_within_subcategory_by_return(self):
        metrics = [
            {'_sub_category': 'Large Cap', 'return_3y': 30.0},
            {'_sub_category': 'Large Cap', 'return_3y': 50.0},
            {'_sub_category': 'Large Cap', 'return_3y': 40.0},
            {'_sub_category': 'Small Cap', 'return_3y': 10.0},
        ]
        assign_ranks(metrics)
        # Large Cap: 50 → rank 1, 40 → rank 2, 30 → rank 3, peers = 3
        assert (metrics[1]['rank_3y'], metrics[1]['peers_3y']) == (1, 3)
        assert (metrics[2]['rank_3y'], metrics[2]['peers_3y']) == (2, 3)
        assert (metrics[0]['rank_3y'], metrics[0]['peers_3y']) == (3, 3)
        # Small Cap is ranked in its own pool of 1
        assert (metrics[3]['rank_3y'], metrics[3]['peers_3y']) == (1, 1)

    def test_funds_without_return_are_not_ranked(self):
        metrics = [
            {'_sub_category': 'Large Cap', 'return_1y': 12.0},
            {'_sub_category': 'Large Cap', 'return_1y': None},
        ]
        assign_ranks(metrics)
        assert metrics[0]['rank_1y'] == 1 and metrics[0]['peers_1y'] == 1
        assert 'rank_1y' not in metrics[1]
