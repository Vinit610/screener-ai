import requests
from bs4 import BeautifulSoup
import random
import time
import logging
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

def scrape_fundamentals(symbol: str) -> Optional[Dict]:
    """Scrape fundamentals from screener.in."""
    url = f"https://www.screener.in/company/{symbol}/"
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # Find top-ratios section
        ratios_section = soup.find(id='top-ratios')
        if not ratios_section:
            logger.warning(f"No ratios section for {symbol}")
            return None

        ratios = {}
        # Parse the ratios - assuming structure with dt/dd or similar
        # This is approximate; may need adjustment based on actual HTML
        for item in ratios_section.find_all(['dt', 'dd']):
            if item.name == 'dt':
                key = item.text.strip().lower().replace(' ', '_')
            elif item.name == 'dd':
                value = parse_float(item.text.strip())
                if value is not None:
                    ratios[key] = value

        return {
            'pe': ratios.get('pe_ratio'),
            'pb': ratios.get('pb_ratio'),
            'roe': ratios.get('return_on_equity'),
            'roce': ratios.get('return_on_capital_employed'),
            'debt_to_equity': ratios.get('total_debt_to_equity'),
            'net_margin': ratios.get('net_margin'),
            'source': 'screener'
        }
    except requests.HTTPError as e:
        if e.response.status_code == 429:
            logger.warning(f"Rate limited for {symbol}, backing off")
            time.sleep(300 + random.uniform(0, 60))
            return scrape_fundamentals(symbol)  # Retry once
        else:
            logger.error(f"HTTP error for {symbol}: {e}")
    except Exception as e:
        logger.error(f"Failed to scrape {symbol}: {e}")
    return None

def fetch_fundamentals(symbols: list = None) -> None:
    """Fetch fundamentals for symbols."""
    if symbols is None:
        with open('nifty500.txt', 'r') as f:
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