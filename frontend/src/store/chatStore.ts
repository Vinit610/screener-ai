import { create } from 'zustand'
import { useScreenerStore } from './screenerStore'
import type { ChatMessage, ScreenerFilters } from '@/types'

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
      // TODO: Replace with actual API call
      // const response = await fetch('/api/ai/parse-query', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ query })
      // })
      // const data = await response.json()

      // Mock AI response for now
      await new Promise(resolve => setTimeout(resolve, 2000)) // Simulate AI processing

      const mockFilters = {
        pe: [10, 30] as [number, number],
        roe: [15, 40] as [number, number],
        sectors: ['IT', 'Pharma']
      }

      // Apply filters to screener store
      useScreenerStore.getState().mergeFilters(mockFilters)

      // Add assistant message about applied filters
      const assistantMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
        role: 'assistant',
        content: `I've applied the following filters based on your query "${query}":\n- P/E ratio: 10-30\n- ROE: 15-40%\n- Sectors: IT, Pharma`,
        type: 'filter_applied',
        filters: mockFilters
      }

      get().addMessage(assistantMessage)

    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to process query',
        isAIThinking: false
      })
    } finally {
      set({ isAIThinking: false })
    }
  },

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, {
      ...message,
      id: Date.now().toString(),
      timestamp: new Date()
    }]
  })),

  clearMessages: () => set({
    messages: [],
    error: null
  }),

  setError: (error) => set({ error })
}))