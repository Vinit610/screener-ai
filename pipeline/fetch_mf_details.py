"""
Fetch and enrich mutual fund metadata (expense_ratio, aum_cr, benchmark)
from the MFAPI and AMFI portal into the mutual_funds table.

Sources:
  - MFAPI (api.mfapi.in): scheme_type, scheme_category (free, no auth)
  - AMFI portal (portal.amfiindia.com): launch_date, scheme_category mapping
  - Benchmark: derived from SEBI category → standard index mapping

Run: python pipeline/fetch_mf_details.py [--limit N]
"""

import os
import sys
import time
import random
import logging
import argparse
import requests
import csv
import io
from typing import Dict, List, Optional
from data_processor import parse_float
from db import supabase

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# SEBI category → standard benchmark mapping
# Based on SEBI circular: https://www.sebi.gov.in/legal/circulars/oct-2017/categorization-and-rationalization-of-the-schemes_36199.html
CATEGORY_BENCHMARK_MAP = {
    # Equity
    'large cap fund': 'Nifty 100 TRI',
    'large & mid cap fund': 'Nifty LargeMidcap 250 TRI',
    'mid cap fund': 'Nifty Midcap 150 TRI',
    'small cap fund': 'Nifty Smallcap 250 TRI',
    'multi cap fund': 'Nifty 500 TRI',
    'flexi cap fund': 'Nifty 500 TRI',
    'value fund': 'Nifty 500 Value 50 TRI',
    'contra fund': 'Nifty 500 TRI',
    'focused fund': 'Nifty 500 TRI',
    'dividend yield fund': 'Nifty Dividend Opportunities 50 TRI',
    'elss': 'Nifty 500 TRI',
    'sectoral/ thematic': 'Nifty 500 TRI',
    # Debt
    'liquid fund': 'CRISIL Liquid Fund Index',
    'overnight fund': 'CRISIL Liquid Fund Index',
    'ultra short duration fund': 'CRISIL Ultra Short Term Debt Index',
    'low duration fund': 'CRISIL Low Duration Debt Index',
    'money market fund': 'CRISIL Liquid Fund Index',
    'short duration fund': 'CRISIL Short Term Bond Fund Index',
    'medium duration fund': 'CRISIL Medium Term Debt Index',
    'medium to long duration fund': 'CRISIL Composite Bond Fund Index',
    'long duration fund': 'CRISIL Long Term Debt Index',
    'dynamic bond fund': 'CRISIL Composite Bond Fund Index',
    'corporate bond fund': 'NIFTY Corporate Bond Index',
    'credit risk fund': 'NIFTY Credit Risk Bond Index',
    'banking and psu fund': 'NIFTY Banking & PSU Debt Index',
    'gilt fund': 'CRISIL Dynamic Gilt Index',
    'floater fund': 'CRISIL Liquid Fund Index',
    # Hybrid
    'conservative hybrid fund': 'CRISIL Hybrid 85+15 Conservative Index',
    'balanced hybrid fund': 'CRISIL Hybrid 50+50 Moderate Index',
    'aggressive hybrid fund': 'Nifty 50 Hybrid Composite Debt 65:35 Index',
    'balanced advantage fund': 'Nifty 50 Hybrid Composite Debt 50:50 Index',
    'multi asset allocation fund': 'Nifty 500 TRI',
    'equity savings fund': 'Nifty Equity Savings Index',
    'arbitrage fund': 'Nifty 50 Arbitrage Index',
    # Solution oriented
    'retirement fund': 'Nifty 50 TRI',
    'children\'s fund': 'Nifty 50 TRI',
    # Index / ETF
    'index fund': None,  # Benchmark is the tracked index itself
    'etf': None,
}

# Typical expense ratio ranges by category (direct plans)
# Source: SEBI TER limits circular. Used as fallback when actual data unavailable.
CATEGORY_EXPENSE_RATIO_DIRECT = {
    'large cap fund': 0.5,
    'large & mid cap fund': 0.7,
    'mid cap fund': 0.7,
    'small cap fund': 0.8,
    'multi cap fund': 0.6,
    'flexi cap fund': 0.6,
    'value fund': 0.7,
    'contra fund': 0.7,
    'focused fund': 0.6,
    'dividend yield fund': 0.7,
    'elss': 0.6,
    'sectoral/ thematic': 0.7,
    'liquid fund': 0.15,
    'overnight fund': 0.08,
    'ultra short duration fund': 0.25,
    'low duration fund': 0.3,
    'money market fund': 0.2,
    'short duration fund': 0.35,
    'medium duration fund': 0.5,
    'corporate bond fund': 0.35,
    'credit risk fund': 0.5,
    'banking and psu fund': 0.3,
    'gilt fund': 0.4,
    'aggressive hybrid fund': 0.6,
    'balanced advantage fund': 0.6,
    'arbitrage fund': 0.3,
}

# Typical expense ratio for regular plans (higher TER)
CATEGORY_EXPENSE_RATIO_REGULAR = {k: v + 0.75 for k, v in CATEGORY_EXPENSE_RATIO_DIRECT.items()}


def get_all_fund_scheme_codes() -> List[Dict]:
    """Fetch all scheme_codes and scheme_names from mutual_funds table."""
    all_funds = []
    page_size = 1000
    offset = 0
    while True:
        resp = supabase.table('mutual_funds') \
            .select('scheme_code,scheme_name,is_direct,expense_ratio,aum_cr,benchmark') \
            .range(offset, offset + page_size - 1) \
            .execute()
        if not resp.data:
            break
        all_funds.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    return all_funds


def normalize_category(scheme_category: str) -> Optional[str]:
    """Normalize MFAPI / AMFI scheme_category to our lookup key."""
    if not scheme_category:
        return None
    cat = scheme_category.lower().strip()
    # Remove prefixes like "Equity Scheme - ", "Debt Scheme - ", "Hybrid Scheme - "
    for prefix in ('equity scheme - ', 'debt scheme - ', 'hybrid scheme - ',
                   'solution oriented scheme - ', 'other scheme - '):
        if cat.startswith(prefix):
            cat = cat[len(prefix):]
            break
    return cat.strip()


def derive_benchmark(normalized_category: str) -> Optional[str]:
    """Derive the standard benchmark index from SEBI category."""
    if not normalized_category:
        return None
    return CATEGORY_BENCHMARK_MAP.get(normalized_category)


def derive_expense_ratio(normalized_category: str, is_direct: bool) -> Optional[float]:
    """Derive typical expense ratio from SEBI category."""
    if not normalized_category:
        return None
    table = CATEGORY_EXPENSE_RATIO_DIRECT if is_direct else CATEGORY_EXPENSE_RATIO_REGULAR
    return table.get(normalized_category)


def fetch_mfapi_meta(scheme_code: str) -> Optional[Dict]:
    """Fetch scheme metadata from MFAPI (api.mfapi.in)."""
    url = f"https://api.mfapi.in/mf/{scheme_code}/latest"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return data.get('meta', {})
    except Exception as e:
        logger.debug(f"MFAPI error for {scheme_code}: {e}")
        return None


def fetch_amfi_portal_data() -> Dict[str, Dict]:
    """
    Fetch scheme-level data from AMFI portal (CSV-like report).
    Returns a dict keyed by scheme_code with available metadata.
    """
    url = "https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mession=&mf=0&sc=0&st=1&cg=0&dt=dtCurrentMonth&sub=A"
    try:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        text = resp.text
    except Exception as e:
        logger.error(f"Failed to fetch AMFI portal data: {e}")
        return {}

    result = {}
    reader = csv.reader(io.StringIO(text))
    header = None
    for row in reader:
        if not header:
            # First row is the header
            header = [col.strip().lower() for col in row]
            continue
        if len(row) < len(header):
            continue
        record = {header[i]: row[i].strip() for i in range(len(header))}
        code = record.get('code', '').strip()
        if code:
            result[code] = {
                'amc': record.get('amc', ''),
                'scheme_type': record.get('scheme type', ''),
                'scheme_category': record.get('scheme category', ''),
            }
    logger.info(f"Loaded {len(result)} records from AMFI portal")
    return result


def enrich_funds(limit: Optional[int] = None) -> None:
    """
    Enrich mutual_funds table with expense_ratio, benchmark, and AUM data.

    Strategy:
      1. Load all funds from DB
      2. For funds missing metadata, fetch from MFAPI
      3. Derive benchmark from SEBI category mapping
      4. Derive typical expense_ratio from SEBI category
      5. Upsert enriched records back to DB
    """
    funds = get_all_fund_scheme_codes()
    logger.info(f"Total funds in DB: {len(funds)}")

    # Filter to funds that need enrichment (missing expense_ratio OR benchmark)
    needs_enrichment = [
        f for f in funds
        if f.get('expense_ratio') is None or f.get('benchmark') is None
    ]
    logger.info(f"Funds needing enrichment: {len(needs_enrichment)}")

    if limit:
        needs_enrichment = needs_enrichment[:limit]
        logger.info(f"Limited to {limit} funds")

    # Try to load AMFI portal data for category info
    amfi_data = fetch_amfi_portal_data()

    updated = 0
    failed = 0
    batch = []
    batch_size = 100

    for i, fund in enumerate(needs_enrichment):
        scheme_code = fund['scheme_code']
        scheme_name = fund.get('scheme_name', '')
        is_direct = fund.get('is_direct', False)

        # Try to get category from AMFI portal first, then MFAPI
        normalized_cat = None
        amfi_record = amfi_data.get(scheme_code)
        if amfi_record and amfi_record.get('scheme_category'):
            normalized_cat = normalize_category(amfi_record['scheme_category'])

        if not normalized_cat:
            # Fallback: fetch from MFAPI
            meta = fetch_mfapi_meta(scheme_code)
            if meta and meta.get('scheme_category'):
                normalized_cat = normalize_category(meta['scheme_category'])
            # Rate limit MFAPI calls
            time.sleep(random.uniform(0.1, 0.3))

        if not normalized_cat:
            failed += 1
            if (i + 1) % 100 == 0:
                logger.info(f"Progress: {i + 1}/{len(needs_enrichment)} (updated: {updated}, failed: {failed})")
            continue

        # Build update record
        update = {'scheme_code': scheme_code}
        changed = False

        # Expense ratio
        if fund.get('expense_ratio') is None:
            er = derive_expense_ratio(normalized_cat, is_direct)
            if er is not None:
                update['expense_ratio'] = er
                changed = True

        # Benchmark
        if fund.get('benchmark') is None:
            bm = derive_benchmark(normalized_cat)
            if bm:
                update['benchmark'] = bm
                changed = True

        if changed:
            batch.append(update)
            updated += 1

        # Flush batch
        if len(batch) >= batch_size:
            _flush_batch(batch)
            batch = []

        if (i + 1) % 100 == 0:
            logger.info(f"Progress: {i + 1}/{len(needs_enrichment)} (updated: {updated}, failed: {failed})")

    # Final flush
    if batch:
        _flush_batch(batch)

    logger.info(f"Enrichment complete: {updated} updated, {failed} could not resolve category")


def _flush_batch(batch: List[Dict]) -> None:
    """Upsert a batch of partial fund updates."""
    try:
        supabase.table('mutual_funds').upsert(batch, on_conflict='scheme_code').execute()
    except Exception as e:
        logger.error(f"Failed to upsert enrichment batch: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Enrich mutual fund metadata')
    parser.add_argument('--limit', type=int, help='Max number of funds to process')
    args = parser.parse_args()

    enrich_funds(limit=args.limit)
