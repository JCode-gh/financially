---
name: project-financially
description: Full financial intelligence dashboard built with Vue 3 + Node.js backend
metadata:
  type: project
---

A complete Bloomberg-style trading dashboard at /Users/jarnestaal/Onderneming/AI Projects/Financially.

**Why:** User wants a self-learning stock prediction dashboard with news sentiment, technical analysis, and accuracy tracking.

**Stack:**
- Backend: Node.js ESM + Express on port 3001 (backend/server.js)
- Frontend: Vue 3 + Vite + Pinia + ApexCharts on port 5175 (frontend/)
- DB: SQLite at backend/data/financially.db
- Charts: vue3-apexcharts (NOT vue-apexcharts — wrong package for Vue 3)

**Start commands:**
- Backend: `cd backend && node server.js`
- Frontend: `cd frontend && npm run dev`
- Or root: `npm run dev` (uses concurrently)

**API Keys needed (all free tier):**
- Finnhub: FINNHUB_API_KEY in backend/.env
- NewsAPI: NEWS_API_KEY in backend/.env
- Yahoo Finance chart API works without a key (v8/finance/chart only — v7 returns 401 without crumb)

**Data sources:**
- Yahoo Finance v8 chart API for historical candles — works without auth
- Yahoo Finance v7 quote API needs cookie+crumb session (auto-managed)
- Mock data fallback (backend/services/mockData.js) when Yahoo is rate-limited
- Finnhub for news + quotes when API key is present
- NewsAPI for financial news when API key is present

**Self-learning prediction model:**
- SQLite stores every prediction with signals, weights, price
- Evaluator runs daily at 9 PM UTC (after US market close) or on-demand via POST /api/predictions/evaluate
- When a prediction resolves, weights update via perceptron-style online learning (LEARNING_RATE=0.015)
- Accuracy tracked per horizon (1d/5d/30d) and per indicator

**Critical bugs fixed:**
- ApexCharts SVG collapses to 0x0 with height="100%" in flex container — must use ResizeObserver to pass pixel height
- yahoo-finance2 npm package v2.11.3 is a Deno port with only 2 modules — replaced with direct axios calls to Yahoo Finance APIs
- Yahoo Finance rate-limits at ~10 req/min — use mock fallback to keep UI functional

**How to apply:** When working on this project, be aware of the API limitations and always verify mock vs live data via the `demo: true` flag in API responses.
