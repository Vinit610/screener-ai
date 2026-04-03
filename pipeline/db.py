from supabase import create_client, Client
from typing import List, Dict, Optional
import logging
from config import config

logger = logging.getLogger(__name__)

# Initialize Supabase client with service role key
supabase: Client = create_client(config.supabase_url, config.supabase_service_role_key)

# Supabase has a payload size limit; batch large upserts
UPSERT_BATCH_SIZE = 500

def _batched_upsert(table: str, records: List[Dict], on_conflict: str) -> None:
    """Upsert records in batches to avoid payload size limits."""
    for i in range(0, len(records), UPSERT_BATCH_SIZE):
        batch = records[i:i + UPSERT_BATCH_SIZE]
        try:
            supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()
        except Exception as e:
            logger.error(f"Failed to upsert batch {i // UPSERT_BATCH_SIZE + 1} into {table}: {e}")
            raise

def upsert_stocks(records: List[Dict]) -> None:
    """Upsert stocks into the stocks table on conflict symbol."""
    if not records:
        return
    _batched_upsert('stocks', records, 'symbol')

def upsert_fundamentals(records: List[Dict]) -> None:
    """Upsert stock fundamentals into the stock_fundamentals table on conflict stock_id."""
    if not records:
        return
    _batched_upsert('stock_fundamentals', records, 'stock_id')

def upsert_prices(records: List[Dict]) -> None:
    """Upsert stock prices into the stock_prices table on conflict (stock_id, date)."""
    if not records:
        return
    _batched_upsert('stock_prices', records, 'stock_id,date')

def upsert_navs(records: List[Dict]) -> None:
    """Upsert MF NAVs into the mf_navs table on conflict (fund_id, date)."""
    if not records:
        return
    _batched_upsert('mf_navs', records, 'fund_id,date')

def upsert_funds(records: List[Dict]) -> None:
    """Upsert mutual funds into the mutual_funds table on conflict scheme_code."""
    if not records:
        return
    _batched_upsert('mutual_funds', records, 'scheme_code')

def get_stock_id(symbol: str) -> Optional[str]:
    """Look up stock UUID by symbol."""
    try:
        response = supabase.table('stocks').select('id').eq('symbol', symbol).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]['id']
    except Exception as e:
        logger.error(f"Failed to get stock_id for {symbol}: {e}")
    return None

def get_fund_id(scheme_code: str) -> Optional[str]:
    """Look up mutual fund UUID by scheme code."""
    try:
        response = supabase.table('mutual_funds').select('id').eq('scheme_code', scheme_code).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]['id']
    except Exception as e:
        logger.error(f"Failed to get fund_id for {scheme_code}: {e}")
    return None

def upsert_news(records: List[Dict]) -> None:
    """Upsert news articles into the news table on conflict url."""
    if not records:
        return
    _batched_upsert('news', records, 'url')

def get_existing_news_urls() -> set:
    """Get set of existing news URLs."""
    response = supabase.table('news').select('url').execute()
    return {row['url'] for row in response.data}