"""
Pydantic schemas for request/response shapes used in the screener API.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Any, Literal
from datetime import date


# ── Stock Fundamentals ────────────────────────────────────────────────────────

class StockFundamentals(BaseModel):
    id: Optional[str] = None
    stock_id: Optional[str] = None
    pe: Optional[float] = None
    pb: Optional[float] = None
    roe: Optional[float] = None
    roce: Optional[float] = None
    debt_to_equity: Optional[float] = None
    net_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    revenue_cr: Optional[float] = None
    net_profit_cr: Optional[float] = None
    eps: Optional[float] = None
    dividend_yield: Optional[float] = None
    book_value: Optional[float] = None
    graham_number: Optional[float] = None
    scraped_at: Optional[str] = None


# ── Stock List / Screener ─────────────────────────────────────────────────────

class StockListItem(BaseModel):
    id: str
    symbol: str
    exchange: str
    name: str
    sector: Optional[str] = None
    industry: Optional[str] = None
    market_cap_cr: Optional[float] = None
    nse_listed: Optional[bool] = None
    is_active: Optional[bool] = None
    updated_at: Optional[str] = None
    fundamentals: Optional[StockFundamentals] = None


class ScreenerResponse(BaseModel):
    data: List[Any]
    total: int
    page: int
    limit: int


# ── Stock Detail ──────────────────────────────────────────────────────────────

class StockPrice(BaseModel):
    date: str
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: float
    volume: Optional[int] = None


class StockDetailResponse(BaseModel):
    id: str
    symbol: str
    exchange: str
    name: str
    sector: Optional[str] = None
    industry: Optional[str] = None
    market_cap_cr: Optional[float] = None
    fundamentals: Optional[StockFundamentals] = None
    latest_price: Optional[StockPrice] = None
    price_history: List[StockPrice] = []


# ── News ──────────────────────────────────────────────────────────────────────

class NewsArticle(BaseModel):
    id: str
    headline: str
    summary: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None
    published_at: Optional[str] = None
    sentiment: Optional[str] = None
    sentiment_score: Optional[float] = None
    related_symbols: Optional[List[str]] = None


class NewsResponse(BaseModel):
    data: List[NewsArticle]
    total: int


# ── MF Schemas ────────────────────────────────────────────────────────────────

class MFListItem(BaseModel):
    id: str
    scheme_code: str
    scheme_name: str
    fund_house: str
    category: Optional[str] = None
    sub_category: Optional[str] = None
    expense_ratio: Optional[float] = None
    aum_cr: Optional[float] = None
    benchmark: Optional[str] = None
    is_direct: Optional[bool] = None
    is_growth: Optional[bool] = None
    is_active: Optional[bool] = None
    updated_at: Optional[str] = None


class MFScreenerResponse(BaseModel):
    data: List[Any]
    total: int
    page: int
    limit: int


class NAVPoint(BaseModel):
    date: str
    nav: float


class MFMetrics(BaseModel):
    """Precomputed per-fund metrics (mf_metrics table)."""
    return_1y: Optional[float] = None
    return_3y: Optional[float] = None
    return_5y: Optional[float] = None
    rank_1y: Optional[int] = None
    peers_1y: Optional[int] = None
    rank_3y: Optional[int] = None
    peers_3y: Optional[int] = None
    rank_5y: Optional[int] = None
    peers_5y: Optional[int] = None
    sharpe_3y: Optional[float] = None
    sortino_3y: Optional[float] = None
    max_drawdown: Optional[float] = None
    max_drawdown_peak_date: Optional[str] = None
    max_drawdown_trough_date: Optional[str] = None
    max_drawdown_recovery_date: Optional[str] = None
    nav_history_start: Optional[str] = None
    latest_nav_date: Optional[str] = None


class MFDetailResponse(BaseModel):
    id: str
    scheme_code: str
    scheme_name: str
    fund_house: str
    category: Optional[str] = None
    sub_category: Optional[str] = None
    expense_ratio: Optional[float] = None
    aum_cr: Optional[float] = None
    benchmark: Optional[str] = None
    is_direct: Optional[bool] = None
    is_growth: Optional[bool] = None
    nav_history: List[NAVPoint] = []
    metrics: Optional[MFMetrics] = None


# ── Compare Schemas ───────────────────────────────────────────────────────────

class CompareResponse(BaseModel):
    type: Literal["stocks", "mf"]
    instrument_a: Any
    instrument_b: Any
