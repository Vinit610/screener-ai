import os
import time
import random
import requests
import yfinance as yf
import pandas as pd
from typing import List, Dict, Optional
import logging
from db import upsert_stocks, upsert_prices, get_stock_id
from data_processor import clean_symbol
import argparse

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Rate limiting constants
DELAY_BETWEEN_STOCKS = 0.5  # seconds between individual stock info requests
DELAY_BETWEEN_BATCHES = 2.0  # seconds between price fetch batches
JITTER_RANGE = 0.3  # +/- seconds of random jitter
MAX_RETRIES = 3
RETRY_BACKOFF = 2.0  # exponential backoff multiplier

def load_symbols(file_path: str = 'nifty500.txt') -> List[str]:
    """Load symbols from file, one per line."""
    # Get the directory where the current script (fetch_prices.py) is located
    base_path = os.path.dirname(__file__)
    # Join it with the filename to get the absolute path
    file_path = os.path.join(base_path, file_path)
    with open(file_path, 'r') as f:
        return [line.strip() for line in f if line.strip()]

def get_stock_info(symbol: str, delay: float = DELAY_BETWEEN_STOCKS) -> Dict:
    """Get stock info from yfinance with exponential backoff retry logic."""
    # Add jitter to delay to make requests look more natural
    jitter = random.uniform(-JITTER_RANGE, JITTER_RANGE)
    actual_delay = max(0.1, delay + jitter)
    time.sleep(actual_delay)
    
    retry_count = 0
    while retry_count < MAX_RETRIES:
        try:
            session = requests.Session()
            session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            })
            ticker = yf.Ticker(symbol, session=session)
            info = ticker.info
            # Convert market cap from USD to INR crores (approximate)
            market_cap_raw = info.get('marketCap', None)
            market_cap_cr = None
            if market_cap_raw:
                # Rough conversion: 1 INR = 0.012 USD, so multiply by ~83 to get INR
                market_cap_inr = market_cap_raw * 83
                market_cap_cr = market_cap_inr / 10_000_000  # Convert to crores
            
            return {
                'symbol': clean_symbol(symbol),
                'exchange': 'NSE',
                'is_active': True,
                'name': info.get('shortName', ''),
                'sector': info.get('sector', ''),
                'industry': info.get('industry', ''),
                'market_cap_cr': market_cap_cr
            }
        except Exception as e:
            retry_count += 1
            error_msg = str(e)
            
            # Check if it's a rate limit error
            is_rate_limit = 'Too Many Requests' in error_msg or '429' in error_msg or 'rate' in error_msg.lower()
            
            if is_rate_limit and retry_count < MAX_RETRIES:
                # Use exponential backoff for rate limiting
                wait_time = RETRY_BACKOFF ** retry_count
                logger.warning(f"Rate limited on {symbol} (attempt {retry_count}/{MAX_RETRIES}). Waiting {wait_time:.1f}s before retry...")
                time.sleep(wait_time)
            elif retry_count < MAX_RETRIES:
                # Standard retry with shorter backoff
                logger.debug(f"Failed to get info for {symbol} (attempt {retry_count}/{MAX_RETRIES}): {error_msg}. Retrying...")
                time.sleep(RETRY_BACKOFF ** (retry_count - 1))
            else:
                # Final failure
                logger.warning(f"Failed to get info for {symbol} after {MAX_RETRIES} attempts: {error_msg}")
                return {
                    'symbol': clean_symbol(symbol),
                    'exchange': 'NSE',
                    'is_active': True,
                    'name': '',
                    'sector': '',
                    'industry': '',
                    'market_cap_cr': None
                }

def fetch_prices(symbols: List[str], period: str = "5d", batch_size: int = 50, info_chunk_size: int = 10) -> None:
    """Fetch and upsert prices for symbols with rate limiting."""
    total_attempted = 0
    total_upserted = 0
    failed_symbols = []

    # First, ensure all stocks exist - process info in chunks
    logger.info(f"Fetching stock info for {len(symbols)} symbols in chunks of {info_chunk_size}...")
    stock_records = []
    
    for chunk_idx in range(0, len(symbols), info_chunk_size):
        chunk = symbols[chunk_idx:chunk_idx + info_chunk_size]
        logger.info(f"Processing info chunk {chunk_idx // info_chunk_size + 1}/{(len(symbols) - 1) // info_chunk_size + 1}: {chunk[:3]}...")
        
        for sym in chunk:
            stock_records.append(get_stock_info(sym))
        
        # Delay between chunks to avoid rate limiting
        if chunk_idx + info_chunk_size < len(symbols):
            jitter = random.uniform(-JITTER_RANGE, JITTER_RANGE)
            chunk_delay = max(0.5, DELAY_BETWEEN_BATCHES + jitter)
            logger.debug(f"Chunk delay: {chunk_delay:.2f}s")
            time.sleep(chunk_delay)
    
    upsert_stocks(stock_records)
    logger.info(f"Upserted {len(stock_records)} stock records")

    # Now fetch prices in batches
    logger.info(f"Fetching prices for {len(symbols)} symbols (batch size: {batch_size})...")
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i+batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(symbols) - 1) // batch_size + 1
        logger.info(f"Processing price batch {batch_num}/{total_batches}: {batch[:3]}...")

        try:
            session = requests.Session()
            session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            })
            # Suppress yfinance logging for cleaner output
            yf_logger = logging.getLogger('yfinance')
            yf_logger.setLevel(logging.ERROR)
            
            data = yf.download(batch, period=period, group_by='ticker', auto_adjust=True, progress=False)
            if data.empty:
                logger.warning(f"No data for batch: {batch}")
                failed_symbols.extend(batch)
                continue

            price_records = []
            for sym in batch:
                try:
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
                except Exception as e:
                    logger.error(f"Error processing symbol {sym}: {e}")
                    failed_symbols.append(sym)

            if price_records:
                upsert_prices(price_records)
                logger.info(f"Upserted {len(price_records)} price records for {len(set(r['stock_id'] for r in price_records))} stocks")
                total_upserted += len(price_records)
            
            total_attempted += len(batch)

        except Exception as e:
            logger.error(f"Failed batch {batch}: {e}")
            failed_symbols.extend(batch)
        
        # Delay between batches
        if i + batch_size < len(symbols):
            jitter = random.uniform(-JITTER_RANGE, JITTER_RANGE)
            batch_delay = max(0.5, DELAY_BETWEEN_BATCHES + jitter)
            logger.debug(f"Batch delay: {batch_delay:.2f}s")
            time.sleep(batch_delay)

    logger.info(f"\n{'='*60}")
    logger.info(f"Pipeline Summary:")
    logger.info(f"  Total symbols attempted: {total_attempted}")
    logger.info(f"  Total rows upserted: {total_upserted}")
    logger.info(f"  Failed symbols ({len(failed_symbols)}): {failed_symbols[:10]}{'...' if len(failed_symbols) > 10 else ''}")
    logger.info(f"{'='*60}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Fetch stock prices for Nifty 500')
    parser.add_argument('--symbols', type=str, help='Comma-separated list of symbols (overrides nifty500.txt)')
    parser.add_argument('--period', type=str, default='5d', help='Period to fetch (default: 5d)')
    parser.add_argument('--batch-size', type=int, default=50, help='Batch size for price fetching (default: 50)')
    parser.add_argument('--info-chunk-size', type=int, default=10, help='Chunk size for fetching stock info (default: 10)')
    parser.add_argument('--delay', type=float, default=DELAY_BETWEEN_STOCKS, help=f'Delay between stock info requests in seconds (default: {DELAY_BETWEEN_STOCKS})')

    args = parser.parse_args()

    if args.symbols:
        symbols = [s.strip() for s in args.symbols.split(',')]
    else:
        symbols = load_symbols()

    fetch_prices(symbols, args.period, args.batch_size, args.info_chunk_size)