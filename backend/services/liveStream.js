// Live trade-tick proxy. The browser connects to our /ws; we keep ONE upstream
// connection to Finnhub's WebSocket (API key stays server-side) and fan out trades
// to interested clients. Subscriptions are ref-counted across clients, and each
// symbol is throttled so a hot ticker can't flood the browser.

import { WebSocketServer } from 'ws';

// Our display symbols → Finnhub WS symbols (crypto needs an exchange prefix;
// indices don't stream on the free tier, so the ticker's indices stay on REST polling).
const CRYPTO_MAP = {
  'BTC-USD': 'BINANCE:BTCUSDT',
  'ETH-USD': 'BINANCE:ETHUSDT',
  'SOL-USD': 'BINANCE:SOLUSDT',
  'BNB-USD': 'BINANCE:BNBUSDT'
};
const REVERSE_MAP = Object.fromEntries(Object.entries(CRYPTO_MAP).map(([k, v]) => [v, k]));
const toFinnhub = s => CRYPTO_MAP[s] || s;
const fromFinnhub = s => REVERSE_MAP[s] || s;

const THROTTLE_MS = 300; // max one tick per symbol per 300ms to each client

export function initLiveStream(server) {
  const KEY = process.env.FINNHUB_API_KEY;
  if (!KEY) {
    console.log('   Live WS: ❌ (no FINNHUB_API_KEY)');
    return;
  }

  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set();        // each client ws has a .symbols Set
  const subCounts = new Map();      // finnhubSymbol → active subscriber count
  const lastSent = new Map();       // finnhubSymbol → last forward timestamp (throttle)
  let upstream = null;

  function connectUpstream() {
    upstream = new WebSocket(`wss://ws.finnhub.io?token=${KEY}`);
    upstream.onopen = () => {
      for (const sym of subCounts.keys()) upstream.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
    };
    upstream.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;

      // Keep only the latest trade per symbol in this batch.
      const latest = new Map();
      for (const t of msg.data) latest.set(t.s, t);

      const now = Date.now();
      for (const [fhSym, t] of latest) {
        const prev = lastSent.get(fhSym) || 0;
        if (now - prev < THROTTLE_MS) continue;
        lastSent.set(fhSym, now);
        const disp = fromFinnhub(fhSym);
        const payload = JSON.stringify({ type: 'trade', symbol: disp, price: t.p, ts: t.t, volume: t.v });
        for (const c of clients) {
          if (c.readyState === 1 && c.symbols.has(disp)) c.send(payload);
        }
      }
    };
    upstream.onclose = () => { setTimeout(connectUpstream, 3000); };
    upstream.onerror = () => { try { upstream.close(); } catch { /* ignore */ } };
  }

  function sub(fhSym) {
    const n = (subCounts.get(fhSym) || 0) + 1;
    subCounts.set(fhSym, n);
    if (n === 1 && upstream?.readyState === 1) upstream.send(JSON.stringify({ type: 'subscribe', symbol: fhSym }));
  }
  function unsub(fhSym) {
    const n = (subCounts.get(fhSym) || 0) - 1;
    if (n <= 0) {
      subCounts.delete(fhSym);
      if (upstream?.readyState === 1) upstream.send(JSON.stringify({ type: 'unsubscribe', symbol: fhSym }));
    } else {
      subCounts.set(fhSym, n);
    }
  }

  wss.on('connection', (ws) => {
    ws.symbols = new Set();
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(m.symbols)) return;
      const next = new Set(m.symbols.map(s => s.toUpperCase()));

      if (m.action === 'set') {
        for (const disp of ws.symbols) if (!next.has(disp)) unsub(toFinnhub(disp));
        for (const disp of next) if (!ws.symbols.has(disp)) sub(toFinnhub(disp));
        ws.symbols = next;
      } else if (m.action === 'subscribe') {
        for (const disp of next) if (!ws.symbols.has(disp)) { ws.symbols.add(disp); sub(toFinnhub(disp)); }
      } else if (m.action === 'unsubscribe') {
        for (const disp of next) if (ws.symbols.has(disp)) { ws.symbols.delete(disp); unsub(toFinnhub(disp)); }
      }
    });

    ws.on('close', () => {
      for (const disp of ws.symbols) unsub(toFinnhub(disp));
      clients.delete(ws);
    });
  });

  connectUpstream();
  console.log('   Live WS: ✅ (/ws → Finnhub stream)');
}
