from supabase import create_client, Client
from typing import List, Dict, Optional
from config import config

# Initialize Supabase client with service role key
supabase: Client = create_client(config.supabase_url, config.supabase_service_role_key)

def upsert_stocks(records: List[Dict]) -> None:
    """Upsert stocks into the stocks table on conflict symbol."""
    if not records:
        return
    supabase.table('stocks').upsert(records, on_conflict='symbol').execute()

def upsert_stock_prices(records: List[Dict]) -> None:
    """Upsert stock prices into the stock_prices table on conflict (symbol, date)."""
    if not records:
        return
    supabase.table('stock_prices').upsert(records, on_conflict='symbol,date').execute()

def upsert_fundamentals(records: List[Dict]) -> None:
    """Upsert stock fundamentals into the stock_fundamentals table on conflict stock_id."""
    if not records:
        return
    supabase.table('stock_fundamentals').upsert(records, on_conflict='stock_id').execute()

def upsert_prices(records: List[Dict]) -> None:
    """Upsert stock prices into the stock_prices table on conflict (stock_id, date)."""
    if not records:
        return
    supabase.table('stock_prices').upsert(records, on_conflict='stock_id,date').execute()

def upsert_navs(records: List[Dict]) -> None:
    """Upsert MF NAVs into the mf_navs table on conflict (fund_id, date)."""
    if not records:
        return
    supabase.table('mf_navs').upsert(records, on_conflict='fund_id,date').execute()

def upsert_funds(records: List[Dict]) -> None:
    """Upsert mutual funds into the mutual_funds table on conflict scheme_code."""
    if not records:
        return
    supabase.table('mutual_funds').upsert(records, on_conflict='scheme_code').execute()

def get_stock_id(symbol: str) -> Optional[str]:
    """Look up stock UUID by symbol."""
    try:
        response = supabase.table('stocks').select('id').eq('symbol', symbol).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]['id']
    except Exception as e:
        logger = __import__('logging').getLogger(__name__)
        logger.error(f"Failed to get stock_id for {symbol}: {e}")
    return None

def get_fund_id(scheme_code: str) -> Optional[str]:
    """Look up mutual fund UUID by scheme code."""
    try:
        response = supabase.table('mutual_funds').select('id').eq('scheme_code', scheme_code).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]['id']
    except Exception as e:
        logger = __import__('logging').getLogger(__name__)
        logger.error(f"Failed to get fund_id for {scheme_code}: {e}")
    return None

def upsert_news(records: List[Dict]) -> None:
    """Upsert news articles into the news table on conflict url."""
    if not records:
        return
    supabase.table('news').upsert(records, on_conflict='url').execute()

def get_existing_news_urls() -> set:
    """Get set of existing news URLs."""
    response = supabase.table('news').select('url').execute()
    return {row['url'] for row in response.data}