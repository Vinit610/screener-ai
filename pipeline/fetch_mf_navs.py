import requests
import pandas as pd
from datetime import datetime
from typing import List, Dict, Optional
import logging
from db import upsert_funds, upsert_navs, get_fund_id
from data_processor import parse_float
import re

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def extract_fund_house(scheme_name: str) -> str:
    """Extract fund house from scheme name (everything before first - or space pattern)."""
    match = re.match(r'^([^-]+)', scheme_name.strip())
    if match:
        return match.group(1).strip()
    return ''

def is_direct_plan(scheme_name: str) -> bool:
    """Check if scheme is a Direct plan."""
    return bool(re.search(r'\bDirect\b', scheme_name, re.IGNORECASE))

def is_growth_plan(scheme_name: str) -> bool:
    """Check if scheme is a Growth plan."""
    return bool(re.search(r'\bGrowth\b', scheme_name, re.IGNORECASE))

def parse_amfi_category(header_line: str) -> tuple:
    """Parse AMFI category header line into (category, sub_category).
    
    Examples:
      'Open Ended Schemes(Debt Scheme - Banking and PSU Fund)' -> ('Debt', 'Banking and PSU Fund')
      'Open Ended Schemes ( Equity Scheme - Large Cap Fund )' -> ('Equity', 'Large Cap Fund')
      'Close Ended Schemes(Equity Scheme - ELSS)' -> ('Equity', 'ELSS')
    """
    match = re.search(r'\(([^)]+)\)', header_line)
    if not match:
        return (None, None)
    inner = match.group(1).strip()
    # Split on ' - ' to get scheme type and sub-category
    parts = inner.split(' - ', 1)
    if len(parts) == 2:
        scheme_type = parts[0].strip()
        sub_cat = parts[1].strip()
        # Extract the main category from scheme type like "Debt Scheme" -> "Debt"
        category = scheme_type.replace('Scheme', '').strip()
        return (category, sub_cat)
    # Fallback: just use the whole thing as category
    return (inner.replace('Scheme', '').strip(), None)

def parse_amfi_date(date_str: str) -> Optional[str]:
    """Parse AMFI date format (DD-Mon-YYYY) to YYYY-MM-DD."""
    for fmt in ('%d-%b-%Y', '%d-%B-%Y', '%d/%m/%Y'):
        try:
            return datetime.strptime(date_str.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None

def fetch_mf_navs() -> None:
    """Fetch and upsert MF NAVs from AMFI."""
    url = "https://www.amfiindia.com/spages/NAVAll.txt"
    logger.info("Fetching NAV data from AMFI...")

    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        data = response.text
    except Exception as e:
        logger.error(f"Failed to fetch NAV data: {e}")
        return

    # Parse the data - AMFI format has category headers (lines without ;)
    # followed by data lines (semicolon-separated)
    lines = data.split('\n')
    current_category = None
    current_sub_category = None
    parsed_lines = []

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if line.count(';') >= 4:
            # Data line: scheme_code;isin_div_payout;isin_growth;scheme_name;nav;date
            parts = line.split(';')
            if len(parts) >= 6:
                scheme_code = parts[0].strip()
                # Skip header row
                if scheme_code.lower().startswith('scheme'):
                    continue
                parsed_lines.append({
                    'scheme_code': scheme_code,
                    'isin_div': parts[1].strip(),
                    'isin_growth': parts[2].strip(),
                    'scheme_name': parts[3].strip(),
                    'nav': parts[4].strip(),
                    'date': parts[5].strip(),
                    'category': current_category,
                    'sub_category': current_sub_category,
                })
        else:
            # Category header line (no semicolons or fewer)
            if '(' in line:
                current_category, current_sub_category = parse_amfi_category(line)

    if not parsed_lines:
        logger.error("No valid NAV data found")
        return

    df = pd.DataFrame(parsed_lines)

    # Filter to Growth plans only (valid ISIN in isin_growth)
    growth_plans = df[df['isin_growth'].str.len() > 0].copy()
    logger.info(f"Found {len(growth_plans)} growth plan NAVs")

    # Narrow to Direct + Growth — the only plan variant the app surfaces.
    # Storing Regular / IDCW variants is dead weight: the screener filters
    # them out and the detail page looks up by scheme_code.
    growth_plans = growth_plans[
        growth_plans['scheme_name'].apply(
            lambda n: is_direct_plan(n) and is_growth_plan(n)
        )
    ].copy()
    logger.info(f"Narrowed to {len(growth_plans)} Direct+Growth plan NAVs")

    # Extract unique funds
    funds = growth_plans[['scheme_code', 'scheme_name', 'category', 'sub_category']].drop_duplicates(subset='scheme_code')
    fund_records = []
    for _, row in funds.iterrows():
        scheme_name = row['scheme_name']
        fund_records.append({
            'scheme_code': row['scheme_code'],
            'scheme_name': scheme_name,
            'fund_house': extract_fund_house(scheme_name),
            'category': row['category'] or None,
            'sub_category': row['sub_category'] or None,
            'is_direct': is_direct_plan(scheme_name),
            'is_growth': is_growth_plan(scheme_name),
            'is_active': True,
        })

    # Upsert funds in batches (Supabase has payload size limits)
    batch_size = 500
    for i in range(0, len(fund_records), batch_size):
        batch = fund_records[i:i + batch_size]
        upsert_funds(batch)
    logger.info(f"Upserted {len(fund_records)} funds")

    # Upsert NAVs
    nav_records = []
    # Build a local cache of fund_ids to avoid repeated DB lookups
    fund_id_cache = {}
    skipped_no_id = 0
    skipped_bad_nav = 0
    skipped_bad_date = 0

    for _, row in growth_plans.iterrows():
        scheme_code = row['scheme_code']

        # Lookup fund_id with caching
        if scheme_code not in fund_id_cache:
            fund_id_cache[scheme_code] = get_fund_id(scheme_code)

        fund_id = fund_id_cache[scheme_code]
        if not fund_id:
            skipped_no_id += 1
            continue

        nav_value = parse_float(row['nav'])
        if nav_value is None:
            skipped_bad_nav += 1
            continue

        # Parse the date from AMFI format
        parsed_date = parse_amfi_date(row['date'])
        if not parsed_date:
            skipped_bad_date += 1
            continue

        nav_records.append({
            'fund_id': fund_id,
            'date': parsed_date,
            'nav': nav_value
        })

    # Upsert NAVs in batches
    for i in range(0, len(nav_records), batch_size):
        batch = nav_records[i:i + batch_size]
        upsert_navs(batch)
    logger.info(f"Upserted {len(nav_records)} NAVs (skipped: {skipped_no_id} no fund_id, {skipped_bad_nav} bad NAV, {skipped_bad_date} bad date)")

if __name__ == "__main__":
    fetch_mf_navs()