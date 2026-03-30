
## 🧠 Product Vision

**An AI-first, hybrid screener for self-directed Indian retail investors** — combining natural language chat with traditional filters to help users discover, compare, and track Indian stocks, mutual funds, and ETFs. Free, dark-mode, English-only, web-first. The core promise: *don't just show numbers — explain the why.*

---

## 👤 Target User

Self-directed retail investor in India. Comfortable with the internet, frustrated with existing tools that feel like spreadsheets with no intelligence. They want to ask questions, not configure 20 dropdown filters. They invest in a mix of direct equities and MFs.

---

## 😤 Core Problems Being Solved

| Problem | How this tool addresses it |
|---|---|
| Too much manual filter-setting | Natural language chat auto-translates intent into filters |
| Can't ask in plain English | Conversational chat panel alongside the screener |
| No MF + stock integration | Unified coverage of equities, MFs, and ETFs |
| Weak / no AI layer | AI explains every result, compares, suggests, and monitors |

---

## 🏗️ Product Architecture (Conceptual)

**Two-panel hybrid UI:**
- **Left/main panel** — Traditional screener with filters (fundamentals, valuation, macro)
- **Right panel** — Conversational AI chat that reads and writes to the screener in real-time
- Dark mode only. Clean, modern — not like Screener.in's 2012 aesthetic.

---

## 📦 Instruments Covered (MVP)

- NSE / BSE listed equities
- Mutual funds (all AMCs via AMFI)
- ETFs

---

## 📊 Data Dimensions

**Stocks:**
- Fundamentals: PE, PB, ROE, ROCE, D/E, margins
- Valuation: DCF, Graham number, intrinsic value estimates
- Macro / Sector: FII/DII flows, sector momentum
- *(No technicals at launch — keeps it focused for value investors)*

**Mutual Funds:**
- NAV, returns, expense ratio, fund house
- Category comparison, rolling returns
- Risk ratios: Sharpe, Sortino, standard deviation

---

## 🤖 AI Feature Set

| Feature | Notes |
|---|---|
| Natural language → filters | "Show me profitable small-caps with low debt" auto-applies filters |
| AI explains every result | Every stock/fund card has a plain-English AI summary of *why* it shows up |
| Side-by-side AI comparison | Compare two stocks or two MFs with AI-generated narrative |
| "Find me something similar" | Suggest comparable instruments based on a selected one |
| News & earnings sentiment | AI-parsed sentiment layer on stock news |
| Weekly digest | AI-generated email summary of user's watchlist / portfolio health |
| Smart alerts | Notify when a stock hits user-defined criteria |
| Famous portfolio lookup | "Show Jhunjhunwala / Dolly Khanna holdings" |

---

## 🎨 Personalization

**Medium depth:** User selects an investment style at onboarding — Value, Growth, or Dividend. The UI adapts: default metrics shown, suggested screener presets, and AI tone all shift accordingly. No deep ML personalization at launch.

---

## 🗂️ MVP Features 

**In MVP:**
1. ✅ AI Screener — NL chat + filter UI, hybrid two-panel
2. ✅ Stock detail page with AI explanation
3. ✅ MF comparison tool (mid-depth)
4. ✅ Portfolio tracker — user inputs holdings, AI monitors
5. ✅ Paper trading / virtual portfolio simulation

**Post-MVP (V2):**
- Alerts & watchlist
- Weekly digest email
- Export to CSV
- ETF-specific screens

---

## 🔐 Auth & Access

- Google OAuth + Email/Password
- No login required for basic browsing (screener visible, but AI features gated behind login)

---

## 💾 Data Strategy

Free & affordable sources only:
- **NSE/BSE** — price, corporate actions, FII/DII data
- **AMFI** — MF NAVs, scheme data
- **Screener.in / Tickertape scraping** — historical fundamentals (carefully, within ToS)
- **News APIs** — for sentiment layer (NewsAPI, MoneyControl RSS, etc.)

---

## ⚖️ Regulatory Positioning

AI outputs framed as **educational insights, not investment advice.** Every AI output carries a disclaimer. No explicit "Buy / Sell" language — instead: *"Based on your value-style criteria, this stock scores highly on..."*

> ⚠️ **Critical flag:** This is a regulatory gray area. Before launch, you need a legal opinion on whether AI-generated "educational signals" cross into SEBI-regulated advisory territory. This could affect your entire product framing.

---

## 🏁 Go-To-Market Differentiation

| Differentiator | vs. Who |
|---|---|
| AI explains the *why* | vs. Screener.in |
| Unified stocks + MF + ETF | vs. Tickertape (stock-heavy) / VRO (MF-only) |
| Paper trading built-in | vs. everyone |
| Completely free | vs. Tickertape Pro, Smallcase |
| Modern dark UI | vs. all incumbents |

---

## 🚦 Honest Assessment & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| 3-month timeline for 5 MVP features as solo founder | 🔴 High | Ruthlessly cut — recommend dropping paper trading from MVP, ship it in month 4 |
| Scraping-based data is fragile | 🟡 Medium | Plan to migrate to a paid API (Tickertape API, Dalalstreet.io) post traction |
| SEBI gray area on AI signals | 🔴 High | Get legal clarity before any public launch |
| Free forever with no monetization model | 🟡 Medium | Define freemium triggers early so the product is built with them in mind |

---

## 📋 Recommended MVP Reprioritization (3 months, solo)

**Month 1:** AI Screener (NL + filters) + Stock detail page with AI explanation
**Month 2:** MF comparison tool + Auth + Onboarding (investment style selection)
**Month 3:** Portfolio tracker + Polish + Beta launch

Paper trading → V2 (month 4–5). It's cool but not core to the screening value prop.
