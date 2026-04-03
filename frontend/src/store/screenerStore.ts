import { create } from 'zustand'
import type { ScreenerFilters, StockResult } from '@/types'

export interface ScreenerState {
  filters: ScreenerFilters
  results: StockResult[]
  isLoading: boolean
  page: number
  limit: number
  total: number
  sortBy: string
  sortDir: string
  error: string | null

  // Actions
  setFilters: (filters: Partial<ScreenerFilters>) => void
  mergeFilters: (partialFilters: Partial<ScreenerFilters>) => void
  fetchResults: () => Promise<void>
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  setSorting: (sortBy: string, sortDir?: string) => void
  resetFilters: () => void
}

const defaultFilters: ScreenerFilters = {
  pe: [0, 100],
  pb: [0, 20],
  dividend_yield: [0, 15],
  roe: [0, 100],
  roce: [0, 100],
  debt_to_equity: [0, 5],
  net_margin: [-50, 50],
  market_cap_category: undefined,
  sector: undefined,
  exclude_loss_making: undefined,
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

/**
 * Convert the local filter state into query-parameter pairs that match the
 * backend `GET /api/stocks/screen` interface.
 *
 * Range filters are only sent when they differ from defaults so we don't clamp
 * the query unnecessarily.
 */
function filtersToSearchParams(
  f: ScreenerFilters,
  page: number,
  limit: number,
  sortBy: string,
  sortDir: string,
): URLSearchParams {
  const params = new URLSearchParams()

  // Range helpers — only include non-default bounds
  const rangeParam = (
    name: string,
    value: [number, number],
    defaultRange: [number, number],
  ) => {
    if (value[0] !== defaultRange[0]) params.set(`min_${name}`, String(value[0]))
    if (value[1] !== defaultRange[1]) params.set(`max_${name}`, String(value[1]))
  }

  rangeParam('pe', f.pe, defaultFilters.pe)
  rangeParam('pb', f.pb, defaultFilters.pb)
  rangeParam('roe', f.roe, defaultFilters.roe)
  rangeParam('roce', f.roce, defaultFilters.roce)

  // debt_to_equity — backend only has max_debt_to_equity
  if (f.debt_to_equity[1] !== defaultFilters.debt_to_equity[1]) {
    params.set('max_debt_to_equity', String(f.debt_to_equity[1]))
  }

  // net_margin — backend only has min_net_margin
  if (f.net_margin[0] !== defaultFilters.net_margin[0]) {
    params.set('min_net_margin', String(f.net_margin[0]))
  }

  // dividend_yield — backend only has min_dividend_yield
  if (f.dividend_yield[0] !== defaultFilters.dividend_yield[0]) {
    params.set('min_dividend_yield', String(f.dividend_yield[0]))
  }

  if (f.market_cap_category) params.set('market_cap_category', f.market_cap_category)
  if (f.sector) params.set('sector', f.sector)
  if (f.exclude_loss_making) params.set('exclude_loss_making', 'true')

  params.set('sort_by', sortBy)
  params.set('sort_dir', sortDir)
  params.set('page', String(page))
  params.set('limit', String(limit))

  return params
}

export const useScreenerStore = create<ScreenerState>((set, get) => ({
  filters: defaultFilters,
  results: [],
  isLoading: false,
  page: 1,
  limit: 50,
  total: 0,
  sortBy: 'market_cap_cr',
  sortDir: 'desc',
  error: null,

  setFilters: (filters) =>
    set((state) => ({
      filters: { ...state.filters, ...filters },
      page: 1,
    })),

  mergeFilters: (partialFilters) =>
    set((state) => ({
      filters: { ...state.filters, ...partialFilters },
      page: 1,
    })),

  fetchResults: async () => {
    const { filters, page, limit, sortBy, sortDir } = get()
    set({ isLoading: true, error: null })

    try {
      const params = filtersToSearchParams(filters, page, limit, sortBy, sortDir)
      const res = await fetch(`${BACKEND_URL}/api/stocks/screen?${params.toString()}`)

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`)
      }

      const data = await res.json()

      set({
        results: data.data ?? [],
        total: data.total ?? 0,
        isLoading: false,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch results',
        isLoading: false,
      })
    }
  },

  setPage: (page) => set({ page }),

  setLimit: (limit) => set({ limit, page: 1 }),

  setSorting: (sortBy, sortDir) =>
    set({ sortBy, sortDir: sortDir ?? 'desc', page: 1 }),

  resetFilters: () =>
    set({
      filters: { ...defaultFilters },
      page: 1,
    }),
}))