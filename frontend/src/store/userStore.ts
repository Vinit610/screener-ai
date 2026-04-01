import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import type { UserProfile, InvestmentStyle } from '@/types'

export interface UserState {
  user: User | null
  profile: UserProfile | null
  isLoading: boolean
  error: string | null

  // Actions
  setUser: (user: User | null) => void
  setProfile: (profile: UserProfile | null) => void
  updateProfile: (updates: Partial<UserProfile>) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  logout: () => void
  completeOnboarding: (investmentStyle: InvestmentStyle) => void
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  profile: null,
  isLoading: false,
  error: null,

  setUser: (user) => set({ user }),

  setProfile: (profile) => set({ profile }),

  updateProfile: (updates) => set((state) => ({
    profile: state.profile ? { ...state.profile, ...updates } : null
  })),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  logout: () => set({
    user: null,
    profile: null,
    error: null
  }),

  completeOnboarding: (investmentStyle) => set((state) => ({
    profile: state.profile ? {
      ...state.profile,
      investment_style: investmentStyle,
      onboarding_done: true
    } : null
  }))
}))