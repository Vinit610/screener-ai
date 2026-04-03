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
  updateLastAssistantMessage: (content: string) => void
  clearMessages: () => void
  setError: (error: string | null) => void
}

/**
 * Apply AI-parsed filters to the screener store.
 */
function applyFiltersToScreener(filters: Record<string, unknown>) {
  const screenerFilters: Partial<ScreenerFilters> = {}

  if (filters.market_cap_category) screenerFilters.market_cap_category = filters.market_cap_category as ScreenerFilters['market_cap_category']
  if (filters.sector) screenerFilters.sector = filters.sector as string
  if (filters.exclude_loss_making) screenerFilters.exclude_loss_making = filters.exclude_loss_making as boolean

  if (filters.min_pe != null || filters.max_pe != null) {
    screenerFilters.pe = [(filters.min_pe as number) ?? 0, (filters.max_pe as number) ?? 100]
  }
  if (filters.min_pb != null || filters.max_pb != null) {
    screenerFilters.pb = [(filters.min_pb as number) ?? 0, (filters.max_pb as number) ?? 20]
  }
  if (filters.min_roe != null || filters.max_roe != null) {
    screenerFilters.roe = [(filters.min_roe as number) ?? 0, (filters.max_roe as number) ?? 100]
  }
  if (filters.min_roce != null || filters.max_roce != null) {
    screenerFilters.roce = [(filters.min_roce as number) ?? 0, (filters.max_roce as number) ?? 100]
  }
  if (filters.max_debt_to_equity != null) {
    screenerFilters.debt_to_equity = [0, filters.max_debt_to_equity as number]
  }
  if (filters.min_net_margin != null) {
    screenerFilters.net_margin = [(filters.min_net_margin as number), 50]
  }
  if (filters.min_dividend_yield != null) {
    screenerFilters.dividend_yield = [(filters.min_dividend_yield as number), 15]
  }

  useScreenerStore.getState().mergeFilters(screenerFilters)
  useScreenerStore.getState().fetchResults()
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

    get().addMessage(userMessage)
    set({ isAIThinking: true, error: null })

    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''
      let streamingText = ''
      let streamingMsgAdded = false
      let handledAsFilter = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload || payload === '[DONE]') {
            // Stream finished
            continue
          }

          try {
            const event = JSON.parse(payload)

            if (event.type === 'intent') {
              // Intent classified — no UI action needed yet
              continue
            }

            if (event.type === 'filters') {
              // Filter intent — apply to screener
              handledAsFilter = true
              const filters = event.data
              const filterCount = Object.keys(filters).length

              applyFiltersToScreener(filters)

              get().addMessage({
                role: 'assistant',
                content: `Applied ${filterCount} filter${filterCount !== 1 ? 's' : ''} based on your query.`,
                type: 'filter_applied',
                filters,
                filterCount,
              })
              continue
            }

            if (event.type === 'done') {
              continue
            }

            // Streaming text token (both {token: "..."} and {type: "token", text: "..."} formats)
            const tokenText = event.token ?? event.text ?? ''
            if (tokenText) {
              streamingText += tokenText
              if (!streamingMsgAdded) {
                streamingMsgAdded = true
                get().addMessage({
                  role: 'assistant',
                  content: streamingText,
                  type: 'message',
                })
              } else {
                get().updateLastAssistantMessage(streamingText)
              }
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }

      // If nothing was added (edge case), add a fallback
      if (!streamingMsgAdded && !handledAsFilter) {
        get().addMessage({
          role: 'assistant',
          content: "I'm not sure how to help with that. Try asking about a specific stock like \"Analyze TCS fundamentals\" or filter stocks with \"Show me profitable IT stocks\".",
          type: 'message',
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

  updateLastAssistantMessage: (content: string) => set((state) => {
    const msgs = [...state.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i] = { ...msgs[i], content }
        break
      }
    }
    return { messages: msgs }
  }),

  clearMessages: () => set({
    messages: [],
    error: null
  }),

  setError: (error) => set({ error })
}))