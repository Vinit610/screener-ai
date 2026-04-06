import os
import time
import random
import requests
import yfinance as yf
import pandas as pd
import numpy as np
import math
from typing import List, Dict, Optional
import logging
from db import upsert_stocks, upsert_prices, upsert_fundamentals, get_stock_id
from data_processor import clean_symbol
import argparse
from curl_cffi import requests


def update_portfolio_current_values():
    """Recalculate current_value on all portfolio_holdings where instrument_type='stock'.

    Joins each holding's symbol to the latest stock price and updates current_value.
    """
    from db import supabase as sb

    logger.info("Updating portfolio holdings current values...")
    resp = (
        sb.table("portfolio_holdings")
        .select("id,symbol,quantity")
        .eq("instrument_type", "stock")
        .execute()
    )
    holdings = resp.data or []
    if not holdings:
        logger.info("No stock holdings to update")
        return

    updated = 0
    for h in holdings:
        stock_resp = (
            sb.table("stocks")
            .select("id")
            .eq("symbol", h["symbol"])
            .maybe_single()
            .execute()
        )
        if not stock_resp.data:
            continue
        price_resp = (
            sb.table("stock_prices")
            .select("close")
            .eq("stock_id", stock_resp.data["id"])
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if not price_resp.data:
            continue
        new_cv = round(h["quantity"] * price_resp.data[0]["close"], 2)
        sb.table("portfolio_holdings").update(
            {"current_value": new_cv}
        ).eq("id", h["id"]).execute()
        updated += 1

    logger.info(f"Updated current_value for {updated} portfolio holdings")

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
    """Get stock info + fundamentals from yfinance with exponential backoff retry logic.

    Returns a dict with 'stock' (for stocks table) and 'fundamentals' (for stock_fundamentals table).
    """
    # Add jitter to delay to make requests look more natural
    jitter = random.uniform(-JITTER_RANGE, JITTER_RANGE)
    actual_delay = max(0.1, delay + jitter)
    time.sleep(actual_delay)
    
    retry_count = 0
    while retry_count < MAX_RETRIES:
        try:
            session = requests.Session(impersonate="chrome")
            ticker = yf.Ticker(symbol, session=session)
            info = ticker.info
            # Convert market cap from USD to INR crores (approximate)
            market_cap_raw = info.get('marketCap', None)
            market_cap_cr = None
            if market_cap_raw:
                # Rough conversion: 1 INR = 0.012 USD, so multiply by ~83 to get INR
                market_cap_inr = market_cap_raw * 83
                market_cap_cr = market_cap_inr / 10_000_000  # Convert to crores

            def safe_num(val):
                """Safely convert to float, return None for missing/NaN."""
                if val is None:
                    return None
                try:
                    f = float(val)
                    return None if math.isnan(f) or math.isinf(f) else f
                except (ValueError, TypeError):
                    return None

            def to_pct(val):
                """Convert decimal ratio (e.g. 0.15) to percentage (15.0)."""
                v = safe_num(val)
                return round(v * 100, 2) if v is not None else None

            def to_cr(val):
                """Convert raw currency value to crores (INR)."""
                v = safe_num(val)
                return round(v / 1_00_00_000, 2) if v is not None else None

            # Extract fundamentals from ticker.info
            pe = safe_num(info.get('trailingPE'))
            pb = safe_num(info.get('priceToBook'))
            roe = to_pct(info.get('returnOnEquity'))
            roce = to_pct(info.get('returnOnAssets'))  # closest proxy available
            debt_to_equity = safe_num(info.get('debtToEquity'))
            dividend_yield = to_pct(info.get('dividendYield'))
            eps = safe_num(info.get('trailingEps'))
            book_value = safe_num(info.get('bookValue'))
            revenue_cr = to_cr(info.get('totalRevenue'))
            net_profit_cr = to_cr(info.get('netIncomeToCommon'))
            net_margin = to_pct(info.get('profitMargins'))
            operating_margin = to_pct(info.get('operatingMargins'))

            # Compute Graham Number: sqrt(22.5 * EPS * Book Value)
            graham_number = None
            if eps is not None and book_value is not None and eps > 0 and book_value > 0:
                graham_number = round(math.sqrt(22.5 * eps * book_value), 2)

            stock_record = {
                'symbol': clean_symbol(symbol),
                'exchange': 'NSE',
                'is_active': True,
                'nse_listed': True,
                'name': info.get('shortName', ''),
                'sector': info.get('sector', ''),
                'industry': info.get('industry', ''),
                'market_cap_cr': round(market_cap_cr, 2) if market_cap_cr else None
            }

            fundamentals_record = {
                'pe': pe,
                'pb': pb,
                'roe': roe,
                'roce': roce,
                'debt_to_equity': debt_to_equity,
                'dividend_yield': dividend_yield,
                'eps': eps,
                'book_value': book_value,
                'revenue_cr': revenue_cr,
                'net_profit_cr': net_profit_cr,
                'net_margin': net_margin,
                'operating_margin': operating_margin,
                'graham_number': graham_number,
            }

            return {'stock': stock_record, 'fundamentals': fundamentals_record}
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
                    'stock': {
                        'symbol': clean_symbol(symbol),
                        'exchange': 'NSE',
                        'is_active': True,
                        'nse_listed': True,
                        'name': '',
                        'sector': '',
                        'industry': '',
                        'market_cap_cr': None
                    },
                    'fundamentals': None
                }

def fetch_prices(symbols: List[str], period: str = "5d", batch_size: int = 50, info_chunk_size: int = 10) -> None:
    """Fetch and upsert prices for symbols with rate limiting."""
    total_attempted = 0
    total_upserted = 0
    failed_symbols = []

    # First, ensure all stocks exist - process info in chunks
    logger.info(f"Fetching stock info + fundamentals for {len(symbols)} symbols in chunks of {info_chunk_size}...")
    stock_records = []
    fundamentals_map = {}  # symbol -> fundamentals dict
    
    for chunk_idx in range(0, len(symbols), info_chunk_size):
        chunk = symbols[chunk_idx:chunk_idx + info_chunk_size]
        logger.info(f"Processing info chunk {chunk_idx // info_chunk_size + 1}/{(len(symbols) - 1) // info_chunk_size + 1}: {chunk[:3]}...")
        
        for sym in chunk:
            result = get_stock_info(sym)
            stock_records.append(result['stock'])
            if result['fundamentals'] is not None:
                fundamentals_map[clean_symbol(sym)] = result['fundamentals']
        
        # Delay between chunks to avoid rate limiting
        if chunk_idx + info_chunk_size < len(symbols):
            jitter = random.uniform(-JITTER_RANGE, JITTER_RANGE)
            chunk_delay = max(0.5, DELAY_BETWEEN_BATCHES + jitter)
            logger.debug(f"Chunk delay: {chunk_delay:.2f}s")
            time.sleep(chunk_delay)
    
    upsert_stocks(stock_records)
    logger.info(f"Upserted {len(stock_records)} stock records")

    # Upsert fundamentals (need stock_id for each)
    fund_records = []
    for sym, fund_data in fundamentals_map.items():
        stock_id = get_stock_id(sym)
        if stock_id:
            fund_records.append({'stock_id': stock_id, **fund_data})
    if fund_records:
        upsert_fundamentals(fund_records)
        logger.info(f"Upserted fundamentals for {len(fund_records)} stocks")
    else:
        logger.warning("No fundamentals to upsert")

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
                        # Convert numpy types to Python native types
                        # and handle NaN values
                        def safe_float(val):
                            if val is None or (isinstance(val, float) and math.isnan(val)):
                                return None
                            try:
                                f = float(val)
                                return None if math.isnan(f) else f
                            except (ValueError, TypeError):
                                return None

                        def safe_int(val):
                            if val is None:
                                return None
                            try:
                                f = float(val)
                                return None if math.isnan(f) else int(f)
                            except (ValueError, TypeError):
                                return None

                        close_val = safe_float(row.get('Close'))
                        if close_val is None:
                            continue  # Skip rows without a close price

                        price_records.append({
                            'stock_id': stock_id,
                            'date': date.strftime('%Y-%m-%d'),
                            'open': safe_float(row.get('Open')),
                            'high': safe_float(row.get('High')),
                            'low': safe_float(row.get('Low')),
                            'close': close_val,
                            'volume': safe_int(row.get('Volume')),
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

    # Update portfolio holdings with latest prices
    try:
        update_portfolio_current_values()
    except Exception as e:
        logger.error(f"Failed to update portfolio current values: {e}")

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