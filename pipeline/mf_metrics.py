"""
Pure metric computations for mutual funds — no I/O, no DB.

Kept separate from compute_mf_metrics.py (which does the Supabase reads/writes)
so the maths is unit-testable in isolation. Each time-dependent function takes
an optional `today` so tests can pin the reference date.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

RISK_FREE_DAILY = 0.065 / 252  # 6.5% annualised → daily
HISTORY_TOLERANCE_DAYS = 10    # grace for weekends / holidays / launch timing
MIN_RETURNS_FOR_RATIO = 30     # min daily returns needed for sharpe / sortino
TRADING_DAYS = 252

Nav = Tuple[str, float]  # (iso_date, nav), ascending by date


def trailing_return(
    navs: List[Nav], calendar_days: int, today: Optional[date] = None
) -> Optional[float]:
    """(latest − past) / past × 100, where 'past' is the first NAV on or after
    (today − calendar_days).

    Returns None when the fund's history doesn't reach back to the target date
    (within HISTORY_TOLERANCE_DAYS) — so a young fund gets no 3Y/5Y return
    rather than a short-window return mislabelled as a long one.
    """
    if len(navs) < 2:
        return None
    today = today or date.today()
    target = today - timedelta(days=calendar_days)
    earliest = date.fromisoformat(navs[0][0])
    if earliest > target + timedelta(days=HISTORY_TOLERANCE_DAYS):
        return None  # insufficient history for this period

    target_iso = target.isoformat()
    lo, hi = 0, len(navs)
    while lo < hi:
        mid = (lo + hi) // 2
        if navs[mid][0] < target_iso:
            lo = mid + 1
        else:
            hi = mid
    if lo >= len(navs):
        return None

    nav_past = navs[lo][1]
    nav_recent = navs[-1][1]
    if nav_past <= 0 or navs[lo][0] == navs[-1][0]:
        return None
    return round((nav_recent - nav_past) / nav_past * 100, 2)


def _window_3y(navs: List[Nav], today: Optional[date] = None) -> Optional[List[Nav]]:
    """NAVs from the last 3 years, or None if the fund lacks 3y of history."""
    if len(navs) < 2:
        return None
    today = today or date.today()
    cutoff = today - timedelta(days=3 * 365)
    earliest = date.fromisoformat(navs[0][0])
    if earliest > cutoff + timedelta(days=HISTORY_TOLERANCE_DAYS):
        return None
    cutoff_iso = cutoff.isoformat()
    window = [n for n in navs if n[0] >= cutoff_iso]
    return window if len(window) >= MIN_RETURNS_FOR_RATIO + 1 else None


def _daily_returns(window: List[Nav]) -> List[float]:
    rets = []
    for i in range(1, len(window)):
        prev = window[i - 1][1]
        curr = window[i][1]
        if prev > 0:
            rets.append((curr - prev) / prev)
    return rets


def sharpe_3y(navs: List[Nav], today: Optional[date] = None) -> Optional[float]:
    """Annualised Sharpe over a fixed trailing-3Y window."""
    window = _window_3y(navs, today)
    if window is None:
        return None
    rets = _daily_returns(window)
    if len(rets) < 2:
        return None
    n = len(rets)
    mean_r = sum(rets) / n
    variance = sum((r - mean_r) ** 2 for r in rets) / (n - 1)
    std = math.sqrt(variance)
    if std == 0:
        return None
    return round((mean_r - RISK_FREE_DAILY) / std * math.sqrt(TRADING_DAYS), 4)


def sortino_3y(navs: List[Nav], today: Optional[date] = None) -> Optional[float]:
    """Annualised Sortino over a fixed trailing-3Y window.

    Like Sharpe, but the denominator is downside deviation — the root-mean-
    square shortfall below the risk-free rate, averaged over all observations
    (upside days contribute 0). Penalises only the volatility that hurts.
    """
    window = _window_3y(navs, today)
    if window is None:
        return None
    rets = _daily_returns(window)
    if len(rets) < 2:
        return None
    n = len(rets)
    mean_r = sum(rets) / n
    downside_sq = [min(0.0, r - RISK_FREE_DAILY) ** 2 for r in rets]
    downside_dev = math.sqrt(sum(downside_sq) / n)
    if downside_dev == 0:
        return None
    return round((mean_r - RISK_FREE_DAILY) / downside_dev * math.sqrt(TRADING_DAYS), 4)


def max_drawdown(navs: List[Nav]) -> Dict:
    """Worst peak-to-trough decline over the full series, plus recovery date.

    Returns a dict with keys max_drawdown (percent, negative), and
    max_drawdown_{peak,trough,recovery}_date. recovery_date is None when the
    fund has not yet climbed back to the pre-drawdown peak.
    """
    empty = {
        'max_drawdown': None,
        'max_drawdown_peak_date': None,
        'max_drawdown_trough_date': None,
        'max_drawdown_recovery_date': None,
    }
    if len(navs) < 2:
        return empty

    peak_date, peak_nav = navs[0]
    worst = None  # (dd, peak_date, peak_nav, trough_date)
    for d, nav in navs:
        if nav > peak_nav:
            peak_nav, peak_date = nav, d
        if peak_nav > 0:
            dd = (nav - peak_nav) / peak_nav
            if worst is None or dd < worst[0]:
                worst = (dd, peak_date, peak_nav, d)

    if worst is None or worst[0] >= 0:
        return {**empty, 'max_drawdown': 0.0}

    dd, wp_date, wp_nav, wt_date = worst
    # Recovery: first NAV at or after the trough that reclaims the prior peak.
    recovery_date = None
    seen_trough = False
    for d, nav in navs:
        if d == wt_date:
            seen_trough = True
            continue
        if seen_trough and nav >= wp_nav:
            recovery_date = d
            break

    return {
        'max_drawdown': round(dd * 100, 2),
        'max_drawdown_peak_date': wp_date,
        'max_drawdown_trough_date': wt_date,
        'max_drawdown_recovery_date': recovery_date,
    }


def assign_ranks(metrics: List[Dict]) -> None:
    """Rank funds by trailing return within each sub_category, per period.

    Mutates each dict in place: sets rank_<p> / peers_<p> for funds that have a
    return for that period, leaves them absent otherwise. Each dict must carry
    a '_sub_category' key and return_1y / return_3y / return_5y.
    """
    by_cat: Dict[str, List[Dict]] = defaultdict(list)
    for m in metrics:
        by_cat[m.get('_sub_category') or '—'].append(m)

    for period in ('1y', '3y', '5y'):
        rkey = f'return_{period}'
        for funds in by_cat.values():
            ranked = sorted(
                (f for f in funds if f.get(rkey) is not None),
                key=lambda f: f[rkey],
                reverse=True,
            )
            n = len(ranked)
            for i, f in enumerate(ranked, start=1):
                f[f'rank_{period}'] = i
                f[f'peers_{period}'] = n
