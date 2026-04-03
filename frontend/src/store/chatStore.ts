import { create } from 'zustand'
import { useScreenerStore } from './screenerStore'
import type { ChatMessage, ScreenerFilters } from '@/types'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

export interface ChatState {
  messages: ChatMessage[]
  isAIThinking: boolean
  error: string | null

  // Actions
  sendQuery: (query: string) => Promise<void>
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  clearMessages: () => void
  setError: (error: string | null) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isAIThinking: false,
  error: null,

  sendQuery: async (query: string) => {
    const userMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
      role: 'user',
      content: query,
      type: 'message'
    }

    // Add user message
    get().addMessage(userMessage)

    // Set AI thinking state
    set({ isAIThinking: true, error: null })

    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/parse-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const filters = await response.json()
      const filterCount = Object.keys(filters).length

      if (filterCount === 0) {
        // No filters extracted — let the user know
        get().addMessage({
          role: 'assistant',
          content: "I couldn't extract specific filters from your query. Try something like \"Show me profitable small-caps with low debt\" or \"IT stocks with high ROE\".",
          type: 'message',
        })
      } else {
        // Convert AI filter response to screener filter format
        const screenerFilters: Partial<ScreenerFilters> = {}

        if (filters.market_cap_category) screenerFilters.market_cap_category = filters.market_cap_category
        if (filters.sector) screenerFilters.sector = filters.sector
        if (filters.exclude_loss_making) screenerFilters.exclude_loss_making = filters.exclude_loss_making

        // Map range-based filters
        if (filters.min_pe != null || filters.max_pe != null) {
          screenerFilters.pe = [filters.min_pe ?? 0, filters.max_pe ?? 100]
        }
        if (filters.min_pb != null || filters.max_pb != null) {
          screenerFilters.pb = [filters.min_pb ?? 0, filters.max_pb ?? 20]
        }
        if (filters.min_roe != null || filters.max_roe != null) {
          screenerFilters.roe = [filters.min_roe ?? 0, filters.max_roe ?? 100]
        }
        if (filters.min_roce != null || filters.max_roce != null) {
          screenerFilters.roce = [filters.min_roce ?? 0, filters.max_roce ?? 100]
        }
        if (filters.max_debt_to_equity != null) {
          screenerFilters.debt_to_equity = [0, filters.max_debt_to_equity]
        }
        if (filters.min_net_margin != null) {
          screenerFilters.net_margin = [filters.min_net_margin, 50]
        }
        if (filters.min_dividend_yield != null) {
          screenerFilters.dividend_yield = [filters.min_dividend_yield, 15]
        }

        // Apply to screener store and fetch results
        useScreenerStore.getState().mergeFilters(screenerFilters)
        useScreenerStore.getState().fetchResults()

        // Build a summary
        const summaryParts: string[] = []
        for (const [key, value] of Object.entries(filters)) {
          summaryParts.push(`${key}: ${value}`)
        }

        get().addMessage({
          role: 'assistant',
          content: `Applied ${filterCount} filter${filterCount !== 1 ? 's' : ''} based on your query.`,
          type: 'filter_applied',
          filters,
          filterCount,
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to process query'
      set({ error: errorMsg })
      get().addMessage({
        role: 'assistant',
        content: errorMsg,
        type: 'error',
      })
    } finally {
      set({ isAIThinking: false })
    }
  },

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, {
      ...message,
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      timestamp: new Date()
    }]
  })),

  clearMessages: () => set({
    messages: [],
    error: null
  }),

  setError: (error) => set({ error })
}))