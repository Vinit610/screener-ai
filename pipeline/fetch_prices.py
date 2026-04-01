import yfinance as yf
import pandas as pd
from typing import List, Dict, Optional
import logging
from db import upsert_stocks, upsert_prices, get_stock_id
from data_processor import clean_symbol
import argparse

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def load_symbols(file_path: str = 'nifty500.txt') -> List[str]:
    """Load symbols from file, one per line."""
    with open(file_path, 'r') as f:
        return [line.strip() for line in f if line.strip()]

def get_stock_info(symbol: str) -> Dict:
    """Get stock info from yfinance."""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return {
            'symbol': clean_symbol(symbol),
            'exchange': 'NSE',
            'is_active': True,
            'name': info.get('shortName', ''),
            'sector': info.get('sector', ''),
            'industry': info.get('industry', ''),
            'market_cap': info.get('marketCap', None)
        }
    except Exception as e:
        logger.warning(f"Failed to get info for {symbol}: {e}")
        return {
            'symbol': clean_symbol(symbol),
            'exchange': 'NSE',
            'is_active': True,
            'name': '',
            'sector': '',
            'industry': '',
            'market_cap': None
        }

def fetch_prices(symbols: List[str], period: str = "5d", batch_size: int = 50) -> None:
    """Fetch and upsert prices for symbols."""
    total_attempted = 0
    total_upserted = 0
    failed_symbols = []

    # First, ensure all stocks exist
    stock_records = []
    for sym in symbols:
        stock_records.append(get_stock_info(sym))
    upsert_stocks(stock_records)
    logger.info(f"Upserted {len(stock_records)} stocks")

    # Now fetch prices in batches
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i+batch_size]
        logger.info(f"Processing batch {i//batch_size + 1}: {batch[:3]}...")

        try:
            data = yf.download(batch, period=period, group_by='ticker', auto_adjust=True)
            if data.empty:
                logger.warning(f"No data for batch: {batch}")
                failed_symbols.extend(batch)
                continue

            price_records = []
            for sym in batch:
                if sym not in data.columns.levels[0]:
                    logger.warning(f"No data for {sym}")
                    failed_symbols.append(sym)
                    continue

                sym_data = data[sym].dropna()
                stock_id = get_stock_id(clean_symbol(sym))
                if not stock_id:
                    logger.error(f"Could not get stock_id for {sym}")
                    failed_symbols.append(sym)
                    continue

                for date, row in sym_data.iterrows():
                    price_records.append({
                        'stock_id': stock_id,
                        'date': date.strftime('%Y-%m-%d'),
                        'open': row.get('Open'),
                        'high': row.get('High'),
                        'low': row.get('Low'),
                        'close': row.get('Close'),
                        'volume': row.get('Volume'),
                        'adj_close': row.get('Adj Close')
                    })

            upsert_prices(price_records)
            total_upserted += len(price_records)
            total_attempted += len(batch)

        except Exception as e:
            logger.error(f"Failed batch {batch}: {e}")
            failed_symbols.extend(batch)

    logger.info(f"Total symbols attempted: {total_attempted}")
    logger.info(f"Total rows upserted: {total_upserted}")
    logger.info(f"Failed symbols: {failed_symbols}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Fetch stock prices for Nifty 500')
    parser.add_argument('--symbols', type=str, help='Comma-separated list of symbols (overrides nifty500.txt)')
    parser.add_argument('--period', type=str, default='5d', help='Period to fetch (default: 5d)')
    parser.add_argument('--batch-size', type=int, default=50, help='Batch size (default: 50)')

    args = parser.parse_args()

    if args.symbols:
        symbols = [s.strip() for s in args.symbols.split(',')]
    else:
        symbols = load_symbols()

    fetch_prices(symbols, args.period, args.batch_size)