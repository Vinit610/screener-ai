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

/**
 * Semantic valuation ranges (Nifty500 context)
 * Based on typical Nifty500 distributions and Indian investor mindsets
 */
const VALUATION_RANGES = {
  pe: {
    cheap: [0, 15] as [number, number],
    fair: [15, 22] as [number, number],
    expensive: [22, 100] as [number, number],
    any: [0, 100] as [number, number],
  },
  pb: {
    cheap: [0, 1.2] as [number, number],
    fair: [1.2, 2.0] as [number, number],
    expensive: [2.0, 20] as [number, number],
    any: [0, 20] as [number, number],
  },
  dividend_yield: {
    cheap: [2, 15] as [number, number],    // "Cheap" = high dividend yield >= 2%
    fair: [1, 2] as [number, number],     // "Fair" = moderate yield 1-2%
    expensive: [0, 1] as [number, number], // "Expensive" = low yield < 1%
    any: [0, 15] as [number, number],     // no filter
  },
} as const


const defaultFilters: ScreenerFilters = {
  pe_semantic: 'any',
  pb_semantic: 'any',
  dividend_yield_semantic: 'any',
  pe: [0, 100],
  pb: [0, 20],
  dividend_yield: [0, 15],
  roe: [0, 100],
  roce: [0, 100],
  debt_to_equity: [0, 5],
  net_margin: [-50, 50],
  quality_gate: false,
  market_cap_category: undefined,
  sector: undefined,
  exclude_loss_making: undefined,
}

/**
 * Map semantic valuation to actual ranges.
 * Used when constructing API queries.
 */
function semanticToRange(
  semantic: string,
  buckets: Record<string, [number, number]>
): [number, number] {
  return buckets[semantic] || buckets['any'] || [0, 1000]
}

import { getBackendUrl } from '@/lib/api'

/**
 * Convert the local filter state into query-parameter pairs that match the
 * backend `GET /api/stocks/screen` interface.
 *
 * Handles semantic valuation mapping and quality gate constraints.
 */
function filtersToSearchParams(
  f: ScreenerFilters,
  page: number,
  limit: number,
  sortBy: string,
  sortDir: string,
): URLSearchParams {
  const params = new URLSearchParams()

  // Map semantic valuations to actual ranges
  const pe = semanticToRange(f.pe_semantic, VALUATION_RANGES.pe)
  const pb = semanticToRange(f.pb_semantic, VALUATION_RANGES.pb)
  const dy = semanticToRange(f.dividend_yield_semantic, VALUATION_RANGES.dividend_yield)

  // Helper to only include non-default range bounds
  const rangeParam = (
    name: string,
    value: [number, number],
    defaultRange: [number, number],
  ) => {
    if (value[0] !== defaultRange[0]) params.set(`min_${name}`, String(value[0]))
    if (value[1] !== defaultRange[1]) params.set(`max_${name}`, String(value[1]))
  }

  // Apply semantic valuations
  rangeParam('pe', pe, [0, 100])
  rangeParam('pb', pb, [0, 20])
  rangeParam('dividend_yield', dy, [0, 15])

  // Quality gate: apply strict thresholds if enabled
  if (f.quality_gate) {
    params.set('min_roe', '15')
    params.set('min_roce', '15')
    params.set('max_debt_to_equity', '2.0')
  } else {
    // Otherwise use user's selected ranges
    rangeParam('roe', f.roe, defaultFilters.roe)
    rangeParam('roce', f.roce, defaultFilters.roce)
    if (f.debt_to_equity[1] !== defaultFilters.debt_to_equity[1]) {
      params.set('max_debt_to_equity', String(f.debt_to_equity[1]))
    }
  }

  // Net margin (optional)
  if (f.net_margin[0] !== defaultFilters.net_margin[0]) {
    params.set('min_net_margin', String(f.net_margin[0]))
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
  limit: 20,
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
      const res = await fetch(`${getBackendUrl()}/api/stocks/screen?${params.toString()}`)

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