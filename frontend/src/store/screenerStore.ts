import { create } from 'zustand'
import type { ScreenerFilters, StockResult } from '@/types'

export interface ScreenerState {
  filters: ScreenerFilters
  results: StockResult[]
  isLoading: boolean
  page: number
  limit: number
  total: number
  error: string | null

  // Actions
  setFilters: (filters: Partial<ScreenerFilters>) => void
  mergeFilters: (partialFilters: Partial<ScreenerFilters>) => void
  fetchResults: () => Promise<void>
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  resetFilters: () => void
}

const defaultFilters: ScreenerFilters = {
  pe: [0, 50],
  pb: [0, 5],
  dividend_yield: [0, 10],
  roe: [0, 50],
  roce: [0, 50],
  debt_to_equity: [0, 2],
  net_margin: [-50, 50],
  market_cap_cr: [0, 50000],
  revenue_growth: [-50, 100],
  profit_growth: [-50, 100],
  sectors: []
}

export const useScreenerStore = create<ScreenerState>((set, get) => ({
  filters: defaultFilters,
  results: [],
  isLoading: false,
  page: 1,
  limit: 20,
  total: 0,
  error: null,

  setFilters: (filters) => set((state) => ({
    filters: { ...state.filters, ...filters },
    page: 1 // Reset to first page when filters change
  })),

  mergeFilters: (partialFilters) => set((state) => ({
    filters: { ...state.filters, ...partialFilters },
    page: 1 // Reset to first page when filters change
  })),

  fetchResults: async () => {
    const { filters, page, limit } = get()
    set({ isLoading: true, error: null })

    try {
      // TODO: Replace with actual API call
      // const response = await fetch('/api/stocks/screen', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ filters, page, limit })
      // })
      // const data = await response.json()

      // Mock data for now
      await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate API delay

      const mockResults: StockResult[] = [
        {
          id: '1',
          symbol: 'RELIANCE',
          name: 'Reliance Industries Ltd',
          sector: 'Oil & Gas',
          pe: 25.3,
          pb: 2.1,
          roe: 8.5,
          market_cap_cr: 18000,
          dividend_yield: 0.3
        },
        {
          id: '2',
          symbol: 'TCS',
          name: 'Tata Consultancy Services Ltd',
          sector: 'IT',
          pe: 28.7,
          pb: 12.5,
          roe: 45.2,
          market_cap_cr: 12500,
          dividend_yield: 1.8
        }
      ]

      set({
        results: mockResults,
        total: mockResults.length,
        isLoading: false
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch results',
        isLoading: false
      })
    }
  },

  setPage: (page) => set({ page }),

  setLimit: (limit) => set({ limit, page: 1 }),

  resetFilters: () => set({
    filters: defaultFilters,
    page: 1
  })
}))