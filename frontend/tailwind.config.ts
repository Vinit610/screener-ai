import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        surface: '#111111',
        border: '#222222',
        muted: '#888888',
        accent: '#22c55e',      // positive returns
        danger: '#ef4444',      // negative returns
        primary: '#3b82f6',     // interactive elements
      },
    },
  },
  plugins: [],
}

export default config