"""
Precompute per-fund metrics for the MF screener and detail page.

For every active Direct+Growth equity fund, computes from its NAV history:
  - trailing returns: 1Y / 3Y / 5Y (calendar-date based)
  - sharpe_3y, sortino_3y: risk-adjusted, over a fixed trailing-3Y window
  - max drawdown + peak / trough / recovery dates

Then ranks funds by trailing return within their sub_category, per period.

Results are upserted into the mf_metrics table. Idempotent — safe to re-run.

Runs after fetch_mf_navs.py in the daily pipeline, and is manually
triggerable via the 'Compute MF Metrics (manual)' workflow.

The maths lives in mf_metrics.py (pure, unit-tested); this file is just the
Supabase I/O and orchestration around it.
"""
import logging
from datetime import datetime, timezone
from typing import Dict, List

from db import supabase, upsert_mf_metrics
from mf_metrics import (
    Nav,
    assign_ranks,
    max_drawdown,
    sharpe_3y,
    sortino_3y,
    trailing_return,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

SUPABASE_PAGE_SIZE = 1000


def fetch_dg_equity_funds() -> List[Dict]:
    """Active Direct+Growth equity funds: id, scheme_code, sub_category."""
    all_rows: List[Dict] = []
    start = 0
    while True:
        resp = (
            supabase.table('mutual_funds')
            .select('id,scheme_code,sub_category')
            .eq('category', 'Equity')
            .eq('is_active', True)
            .eq('is_direct', True)
            .eq('is_growth', True)
            .range(start, start + SUPABASE_PAGE_SIZE - 1)
            .execute()
        )
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < SUPABASE_PAGE_SIZE:
            break
        start += SUPABASE_PAGE_SIZE
    return all_rows


def fetch_navs(fund_id: str) -> List[Nav]:
    """All NAVs for a fund, ascending by date, as (date, nav) tuples.

    Paginated — Supabase caps a single REST response at 1000 rows.
    """
    all_rows: List[Nav] = []
    start = 0
    while True:
        resp = (
            supabase.table('mf_navs')
            .select('date,nav')
            .eq('fund_id', fund_id)
            .order('date', desc=False)
            .range(start, start + SUPABASE_PAGE_SIZE - 1)
            .execute()
        )
        rows = resp.data or []
        for r in rows:
            if r['nav'] is not None:
                all_rows.append((r['date'], float(r['nav'])))
        if len(rows) < SUPABASE_PAGE_SIZE:
            break
        start += SUPABASE_PAGE_SIZE
    return all_rows


def main():
    funds = fetch_dg_equity_funds()
    logger.info(f"Computing metrics for {len(funds)} Direct+Growth equity funds")

    metrics: List[Dict] = []
    errors = 0
    skipped_no_navs = 0

    for idx, fund in enumerate(funds, start=1):
        try:
            navs = fetch_navs(fund['id'])
            if len(navs) < 2:
                skipped_no_navs += 1
                continue
            row = {
                'fund_id': fund['id'],
                '_sub_category': fund.get('sub_category'),
                'return_1y': trailing_return(navs, 365),
                'return_3y': trailing_return(navs, 3 * 365),
                'return_5y': trailing_return(navs, 5 * 365),
                'sharpe_3y': sharpe_3y(navs),
                'sortino_3y': sortino_3y(navs),
                'nav_history_start': navs[0][0],
                'latest_nav_date': navs[-1][0],
                **max_drawdown(navs),
            }
            metrics.append(row)
        except Exception as e:
            errors += 1
            logger.warning(f"[{fund.get('scheme_code')}] failed: {e}")
        if idx % 100 == 0:
            logger.info(f"Progress {idx}/{len(funds)}")

    assign_ranks(metrics)

    now_iso = datetime.now(timezone.utc).isoformat()
    records: List[Dict] = []
    for m in metrics:
        m.pop('_sub_category', None)
        for p in ('1y', '3y', '5y'):
            m.setdefault(f'rank_{p}', None)
            m.setdefault(f'peers_{p}', None)
        m['computed_at'] = now_iso
        records.append(m)

    upsert_mf_metrics(records)
    logger.info(
        f"Done. funds={len(funds)} upserted={len(records)} "
        f"skipped_no_navs={skipped_no_navs} errors={errors}"
    )


if __name__ == '__main__':
    main()
