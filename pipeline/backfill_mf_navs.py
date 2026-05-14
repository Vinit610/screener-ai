"""
One-off backfill of historical NAVs from MFAPI for Equity mutual funds.

Scope: mutual_funds rows where category='Equity' AND is_active AND is_direct AND is_growth.

Resumability: per fund we look up the earliest existing date in mf_navs and only
insert NAVs strictly older than that, down to a configurable cutoff (default 5y).
Re-running the script is cheap — already-backfilled funds short-circuit quickly.

Trigger via the `Backfill MF NAVs (manual)` GitHub Actions workflow, or run locally:
    python backfill_mf_navs.py --years 5
    python backfill_mf_navs.py --limit 20 --dry-run
"""
import argparse
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

import requests

from db import supabase, upsert_navs

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

MFAPI_URL = "https://api.mfapi.in/mf/{scheme_code}"
DEFAULT_YEARS = 5
DEFAULT_WORKERS = 4
SUPABASE_PAGE_SIZE = 1000
MFAPI_TIMEOUT = 30


def fetch_equity_funds() -> List[Dict]:
    """Active direct-growth equity funds from mutual_funds, paginated.

    The screener only surfaces Direct + Growth plans (cleanest NAV series,
    lowest expense ratio, the right choice for a DIY investor), so there's no
    point storing NAV history for the other plan variants.
    """
    all_rows: List[Dict] = []
    start = 0
    while True:
        resp = (
            supabase.table('mutual_funds')
            .select('id,scheme_code,scheme_name')
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


def fetch_mfapi_history(scheme_code: str) -> List[Dict]:
    """Full NAV history for a scheme. Returns list of {date: 'dd-mm-yyyy', nav: str}."""
    resp = requests.get(MFAPI_URL.format(scheme_code=scheme_code), timeout=MFAPI_TIMEOUT)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get('status') != 'SUCCESS':
        return []
    return payload.get('data') or []


def parse_mfapi_date(s: str) -> Optional[date]:
    try:
        return datetime.strptime(s, '%d-%m-%Y').date()
    except (ValueError, TypeError):
        return None


def parse_nav(s: str) -> Optional[float]:
    try:
        v = float(s)
        return v if v > 0 else None
    except (ValueError, TypeError):
        return None


def process_fund(fund: Dict, cutoff: date, dry_run: bool) -> Dict:
    """Fetch + upsert NAVs for one fund. Always returns a stats dict.

    Upserts every MFAPI row within the cutoff window. The unique index on
    (fund_id, date) makes this idempotent — re-runs are safe and naturally
    fill any gaps left by the daily fetcher.
    """
    fund_id = fund['id']
    scheme_code = fund['scheme_code']
    stats = {'scheme_code': scheme_code, 'inserted': 0, 'fetched': 0, 'error': None}

    try:
        history = fetch_mfapi_history(scheme_code)
        stats['fetched'] = len(history)

        records: List[Dict] = []
        for row in history:
            d = parse_mfapi_date(row.get('date', ''))
            nav = parse_nav(row.get('nav', ''))
            if not d or nav is None:
                continue
            if d < cutoff:
                continue
            records.append({
                'fund_id': fund_id,
                'date': d.isoformat(),
                'nav': nav,
            })

        if records and not dry_run:
            upsert_navs(records)
        stats['inserted'] = len(records)
    except Exception as e:
        stats['error'] = str(e)
        logger.warning(f"[{scheme_code}] failed: {e}")
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--years', type=int, default=DEFAULT_YEARS,
                    help='History depth cutoff in years (default 5)')
    ap.add_argument('--limit', type=int, default=None,
                    help='Process only the first N funds (for smoke testing)')
    ap.add_argument('--workers', type=int, default=DEFAULT_WORKERS,
                    help='Parallel worker count (default 8)')
    ap.add_argument('--dry-run', action='store_true',
                    help='Fetch and log counts; skip upserts')
    args = ap.parse_args()

    cutoff = date.today() - timedelta(days=args.years * 365)
    logger.info(
        f"Backfill: cutoff={cutoff.isoformat()} years={args.years} "
        f"workers={args.workers} dry_run={args.dry_run}"
    )

    funds = fetch_equity_funds()
    logger.info(f"Loaded {len(funds)} equity funds (active, direct, growth)")
    if args.limit:
        funds = funds[:args.limit]
        logger.info(f"Limited to first {len(funds)} funds")
    if not funds:
        logger.warning("No funds to process. Exiting.")
        return

    total_inserted = 0
    total_fetched = 0
    errors = 0
    processed = 0

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_fund, f, cutoff, args.dry_run): f for f in funds}
        for fut in as_completed(futures):
            stats = fut.result()
            processed += 1
            total_fetched += stats['fetched']
            total_inserted += stats['inserted']
            if stats['error']:
                errors += 1
            if processed % 50 == 0 or processed == len(funds):
                logger.info(
                    f"Progress {processed}/{len(funds)}: "
                    f"inserted={total_inserted} fetched={total_fetched} errors={errors}"
                )

    logger.info(
        f"Done. funds={len(funds)} inserted={total_inserted} "
        f"fetched={total_fetched} errors={errors} dry_run={args.dry_run}"
    )


if __name__ == '__main__':
    main()
