// Database Entity Types
export interface Stock {
  id: string
  symbol: string
  name: string
  sector: string | null
  industry: string | null
  market_cap_cr: number | null
  nse_listed: boolean
  bse_listed: boolean
  is_active: boolean
  updated_at: string
}

export interface StockFundamentals {
  id: string
  stock_id: string
  pe: number | null
  pb: number | null
  roe: number | null
  roce: number | null
  debt_to_equity: number | null
  net_margin: number | null
  operating_margin: number | null
  revenue_cr: number | null
  net_profit_cr: number | null
  eps: number | null
  dividend_yield: number | null
  book_value: number | null
  graham_number: number | null
  scraped_at: string
}

export interface StockPrice {
  id: string
  stock_id: string
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
}

export interface MutualFund {
  id: string
  scheme_code: string
  scheme_name: string
  fund_house: string
  category: string | null
  sub_category: string | null
  expense_ratio: number | null
  aum_cr: number | null
  benchmark: string | null
  is_direct: boolean
  is_growth: boolean
  is_active: boolean
  updated_at: string
}

export interface MFNAV {
  id: string
  fund_id: string
  date: string
  nav: number
}

export interface News {
  id: string
  headline: string
  summary: string | null
  url: string
  source: string | null
  published_at: string | null
  sentiment: 'positive' | 'negative' | 'neutral'
  sentiment_score: number
  related_symbols: string[]
  processed_at: string
}

export interface PortfolioHolding {
  id: string
  user_id: string
  symbol: string
  instrument_type: 'stock' | 'mf'
  quantity: number
  avg_buy_price: number
  current_value: number | null
  unrealised_pnl: number | null
  buy_date: string | null
  broker: 'zerodha' | 'groww' | 'upstox' | 'other' | null
  is_paper: boolean
  created_at: string
}

export interface UserProfile {
  id: string
  investment_style: 'value' | 'growth' | 'dividend' | null
  onboarding_done: boolean
  created_at: string
}

// Filter Types
export type MarketCapCategory = 'large' | 'mid' | 'small' | 'micro'

export interface ScreenerFilters {
  // Valuation filters
  pe: [number, number]
  pb: [number, number]
  dividend_yield: [number, number]

  // Quality filters
  roe: [number, number]
  roce: [number, number]
  debt_to_equity: [number, number]
  net_margin: [number, number]

  // Size filters
  market_cap_cr: [number, number]

  // Returns filters
  revenue_growth: [number, number]
  profit_growth: [number, number]

  // Sector filter
  sectors: string[]
}

export interface MFFilters {
  category?: string
  fund_house?: string
  expense_ratio_max?: number
  aum_min?: number
  is_direct?: boolean
}

// API Request/Response Types
export interface ScreenerRequest {
  filters: Partial<ScreenerFilters>
  page: number
  limit: number
}

export interface ScreenerResponse {
  data: StockResult[]
  total: number
  page: number
  limit: number
}

export interface StockDetailResponse {
  stock: Stock
  fundamentals: StockFundamentals | null
  latest_price: StockPrice | null
  prices: StockPrice[] // Last 365 days
}

export interface StockNewsResponse {
  news: News[]
  total: number
}

export interface AIParseQueryRequest {
  query: string
}

export interface AIParseQueryResponse {
  filters: Partial<ScreenerFilters>
  explanation?: string
}

export interface AIExplainStockRequest {
  symbol: string
}

export interface AICompareRequest {
  symbol_a: string
  symbol_b: string
}

// UI Component Types
export interface StockResult {
  id: string
  symbol: string
  name: string
  sector: string | null
  pe: number | null
  pb: number | null
  roe: number | null
  market_cap_cr: number | null
  dividend_yield: number | null
}

export type StockCardVariant = 'table-row' | 'detail' | 'chat-embed'

export interface StockCardProps {
  stock: StockResult
  variant: StockCardVariant
  showAI?: boolean
}

// Auth Types
export type InvestmentStyle = 'value' | 'growth' | 'dividend'

// Chat Types
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  type?: 'message' | 'filter_applied'
  filters?: Partial<ScreenerFilters>
}

// Error Types
export interface APIError {
  message: string
  code?: string
  details?: any
}

// Utility Types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}