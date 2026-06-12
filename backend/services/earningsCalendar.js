// Upcoming earnings dates via Finnhub's free earnings calendar.
// Earnings are the single biggest scheduled volatility event for a stock —
// the scanner flags anything reporting within a few days as "event risk".

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BASE = 'https://finnhub.io/api/v1';
const KEY = process.env.FINNHUB_API_KEY || '';

let cache = { data: null, ts: 0 };
const TTL = 6 * 3600_000; // earnings dates don't move intraday

// Map: SYMBOL → { date, hour, epsEstimate, revenueEstimate, daysUntil }
export async function getUpcomingEarnings(daysAhead = 21) {
  if (!KEY) return {};
  if (cache.data && Date.now() - cache.ts < TTL) return cache.data;

  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0];

  try {
    const res = await axios.get(`${BASE}/calendar/earnings`, {
      params: { from, to, token: KEY },
      timeout: 10000
    });
    const list = res.data?.earningsCalendar || [];
    const map = {};
    const today = new Date(from);
    for (const e of list) {
      if (!e.symbol || !e.date) continue;
      const days = Math.round((new Date(e.date) - today) / 86400000);
      // Keep the earliest upcoming date per symbol
      if (!map[e.symbol] || e.date < map[e.symbol].date) {
        map[e.symbol] = {
          date: e.date,
          hour: e.hour || '',
          epsEstimate: e.epsEstimate ?? null,
          revenueEstimate: e.revenueEstimate ?? null,
          daysUntil: days
        };
      }
    }
    cache = { data: map, ts: Date.now() };
    return map;
  } catch {
    return cache.data || {};
  }
}
