import os
import requests
from bs4 import BeautifulSoup
import random
import time
import logging
import re
from typing import Dict, Optional
from db import upsert_fundamentals, get_stock_id
from data_processor import clean_symbol, parse_float
from config import config

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.screener.in/",
}

# Mapping from screener.in ratio name to our DB field name
RATIO_KEY_MAP = {
    'stock p/e': 'pe',
    'price to earning': 'pe',
    'book value': 'book_value',
    'dividend yield': 'dividend_yield',
    'roce': 'roce',
    'roe': 'roe',
    'face value': None,  # skip
    'market cap': None,  # already from yfinance
    'current price': None,
    'high / low': None,
}


def parse_ratio_value(text: str) -> Optional[float]:
    """Parse a ratio value from screener.in, handling % signs and commas."""
    if not text:
        return None
    text = text.strip().replace(',', '').replace('%', '')
    return parse_float(text)


def scrape_fundamentals(symbol: str) -> Optional[Dict]:
    """Scrape fundamentals from screener.in."""
    url = f"https://www.screener.in/company/{symbol}/"
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        result = {}

        # ── 1. Parse top-ratios section ──
        # Screener.in uses <li> with <span class="name"> and <span class="number">
        ratios_section = soup.find(id='top-ratios')
        if ratios_section:
            for li in ratios_section.find_all('li'):
                name_span = li.find('span', class_='name')
                number_span = li.find('span', class_='number')
                if not name_span or not number_span:
                    continue
                name = name_span.get_text(strip=True).lower()
                value_text = number_span.get_text(strip=True)
                
                # Map to DB field
                db_key = None
                for pattern, key in RATIO_KEY_MAP.items():
                    if pattern in name:
                        db_key = key
                        break
                
                if db_key:
                    result[db_key] = parse_ratio_value(value_text)

        # ── 2. Parse key financial data from the "Profit & Loss" / financials sections ──
        # Look for the quarterly/annual results sections
        sections = soup.find_all('section')
        for section in sections:
            heading = section.find(['h2', 'h3'])
            if not heading:
                continue
            heading_text = heading.get_text(strip=True).lower()

            # Profit & Loss section — extract revenue, net profit, EPS, operating margin
            if 'profit' in heading_text and 'loss' in heading_text:
                table = section.find('table')
                if table:
                    _parse_pl_table(table, result)

            # Balance Sheet — extract debt to equity
            if 'balance sheet' in heading_text:
                table = section.find('table')
                if table:
                    _parse_balance_sheet(table, result)

        # ── 3. Parse ratios section if there's a dedicated one ──
        ratios_section2 = soup.find('section', id='ratios')
        if ratios_section2:
            table = ratios_section2.find('table')
            if table:
                _parse_ratios_table(table, result)

        if not result:
            logger.warning(f"No fundamentals extracted for {symbol}")
            return None

        return result

    except requests.HTTPError as e:
        if e.response.status_code == 429:
            logger.warning(f"Rate limited for {symbol}, backing off")
            time.sleep(300 + random.uniform(0, 60))
            return scrape_fundamentals(symbol)  # Retry once
        elif e.response.status_code == 404:
            logger.warning(f"Company page not found for {symbol}")
        else:
            logger.error(f"HTTP error for {symbol}: {e}")
    except Exception as e:
        logger.error(f"Failed to scrape {symbol}: {e}")
    return None


def _get_last_annual_value(row_cells) -> Optional[float]:
    """Get the latest annual (last column) value from a table row."""
    # Table rows typically have: label, then yearly values (latest last or second to last)
    # We want the most recent full-year value
    for cell in reversed(row_cells[1:]):
        val = parse_ratio_value(cell.get_text(strip=True))
        if val is not None:
            return val
    return None


def _parse_pl_table(table, result: Dict) -> None:
    """Extract revenue, net profit, EPS, operating margin from P&L table."""
    for row in table.find_all('tr'):
        cells = row.find_all(['td', 'th'])
        if len(cells) < 2:
            continue
        label = cells[0].get_text(strip=True).lower()
        
        if label.startswith('sales') or label.startswith('revenue'):
            val = _get_last_annual_value(cells)
            if val is not None:
                result['revenue_cr'] = val
        elif label.startswith('net profit'):
            val = _get_last_annual_value(cells)
            if val is not None:
                result['net_profit_cr'] = val
        elif label.startswith('eps'):
            val = _get_last_annual_value(cells)
            if val is not None:
                result['eps'] = val
        elif 'opm' in label or 'operating profit margin' in label:
            val = _get_last_annual_value(cells)
            if val is not None:
                result['operating_margin'] = val
        elif 'net profit margin' in label or label == 'npm':
            val = _get_last_annual_value(cells)
            if val is not None:
                result['net_margin'] = val


def _parse_balance_sheet(table, result: Dict) -> None:
    """Extract debt-to-equity from balance sheet table."""
    total_debt = None
    shareholders_equity = None
    for row in table.find_all('tr'):
        cells = row.find_all(['td', 'th'])
        if len(cells) < 2:
            continue
        label = cells[0].get_text(strip=True).lower()
        if 'borrowing' in label or 'total debt' in label:
            val = _get_last_annual_value(cells)
            if val is not None:
                total_debt = (total_debt or 0) + val
        elif 'equity' in label and 'share' not in label:
            val = _get_last_annual_value(cells)
            if val is not None:
                shareholders_equity = val

    if total_debt is not None and shareholders_equity and shareholders_equity > 0:
        if 'debt_to_equity' not in result:
            result['debt_to_equity'] = round(total_debt / shareholders_equity, 2)


def _parse_ratios_table(table, result: Dict) -> None:
    """Parse the dedicated ratios section table."""
    for row in table.find_all('tr'):
        cells = row.find_all(['td', 'th'])
        if len(cells) < 2:
            continue
        label = cells[0].get_text(strip=True).lower()

        if 'roe' in label and 'roe' not in result:
            val = _get_last_annual_value(cells)
            if val is not None:
                result['roe'] = val
        elif 'roce' in label and 'roce' not in result:
            val = _get_last_annual_value(cells)
            if val is not None:
                result['roce'] = val
        elif 'debt to equity' in label and 'debt_to_equity' not in result:
            val = _get_last_annual_value(cells)
            if val is not None:
                result['debt_to_equity'] = val
        elif 'dividend yield' in label and 'dividend_yield' not in result:
            val = _get_last_annual_value(cells)
            if val is not None:
                result['dividend_yield'] = val

def fetch_fundamentals(symbols: list = None) -> None:
    """Fetch fundamentals for symbols."""
    if symbols is None:
        base_path = os.path.dirname(__file__)
        file_path = os.path.join(base_path, 'nifty500.txt')
        with open(file_path, 'r') as f:
            symbols = [clean_symbol(line.strip()) for line in f if line.strip()]

    logger.info(f"Processing {len(symbols)} symbols")

    for i, symbol in enumerate(symbols):
        logger.info(f"Processing {symbol} ({i+1}/{len(symbols)})")

        stock_id = get_stock_id(symbol)  # symbol is already cleaned
        if not stock_id:
            logger.warning(f"No stock_id for {symbol}")
            continue

        fundamentals = scrape_fundamentals(symbol)
        if fundamentals:
            record = {'stock_id': stock_id, **fundamentals}
            upsert_fundamentals([record])
            logger.info(f"Upserted fundamentals for {symbol}")
        else:
            logger.warning(f"No fundamentals found for {symbol}")

        # Sleep between requests
        time.sleep(random.uniform(3, 7))

        # Extra pause every 50
        if (i + 1) % 50 == 0:
            pause = random.uniform(60, 120)
            logger.info(f"Pausing for {pause:.1f} seconds")
            time.sleep(pause)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        symbols = sys.argv[1:]
    else:
        symbols = None
    fetch_fundamentals(symbols)