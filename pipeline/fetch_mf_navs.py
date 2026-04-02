import requests
import pandas as pd
from typing import List, Dict
import logging
from db import upsert_funds, upsert_navs, get_fund_id
from data_processor import parse_float
import re

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def extract_fund_house(scheme_name: str) -> str:
    """Extract fund house from scheme name (everything before first - or space pattern)."""
    # Common patterns: "HDFC Equity Fund - Growth" -> "HDFC"
    # Or "SBI Bluechip Fund Regular Growth" -> "SBI"
    match = re.match(r'^([^-]+)', scheme_name.strip())
    if match:
        return match.group(1).strip()
    return ''

def fetch_mf_navs() -> None:
    """Fetch and upsert MF NAVs from AMFI."""
    url = "https://www.amfiindia.com/spages/NAVAll.txt"
    logger.info("Fetching NAV data from AMFI...")

    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.text
    except Exception as e:
        logger.error(f"Failed to fetch NAV data: {e}")
        return

    # Parse the data
    lines = data.split('\n')
    parsed_lines = []

    for line in lines:
        if line.count(';') >= 5:
            parts = line.split(';')
            if len(parts) >= 6:
                parsed_lines.append({
                    'scheme_code': parts[0].strip(),
                    'isin_div': parts[1].strip(),
                    'isin_growth': parts[2].strip(),
                    'scheme_name': parts[3].strip(),
                    'nav': parts[4].strip(),
                    'date': parts[5].strip()
                })

    if not parsed_lines:
        logger.error("No valid NAV data found")
        return

    df = pd.DataFrame(parsed_lines)

    # Filter to Growth plans only (valid ISIN in isin_growth)
    growth_plans = df[df['isin_growth'].str.len() > 0].copy()
    logger.info(f"Found {len(growth_plans)} growth plan NAVs")

    # Extract unique funds
    funds = growth_plans[['scheme_code', 'scheme_name']].drop_duplicates()
    fund_records = []
    for _, row in funds.iterrows():
        fund_records.append({
            'scheme_code': row['scheme_code'],
            'scheme_name': row['scheme_name'],
            'fund_house': extract_fund_house(row['scheme_name']),
            'is_active': True
        })

    # Upsert funds
    upsert_funds(fund_records)
    logger.info(f"Upserted {len(fund_records)} funds")

    # Upsert NAVs
    nav_records = []
    for _, row in growth_plans.iterrows():
        fund_id = get_fund_id(row['scheme_code'])
        if not fund_id:
            logger.warning(f"Could not get fund_id for {row['scheme_code']}")
            continue
        nav_value = parse_float(row['nav'])
        if nav_value is not None:
            nav_records.append({
                'fund_id': fund_id,
                'date': row['date'],
                'nav': nav_value
            })

    upsert_navs(nav_records)
    logger.info(f"Upserted {len(nav_records)} NAVs")

if __name__ == "__main__":
    fetch_mf_navs()