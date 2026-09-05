// Scenario path for the chart forecast overlay.
// Horizon targets come from the model; the path between them is built from
// this symbol's own tape (vol, candle shapes, streaks) plus S/R, RSI, ADX,
// MAs, news, and momentum so the candles move like the history, not a line.

export const FORECAST_DAYS = 30;
export const HORIZON_DAYS = { '1d': 1, '5d': 5, '30d': 30 };

export function seedRng(symbol, lastClose, targets) {
  const key = `${symbol || ''}|${Number(lastClose).toFixed(4)}|${(targets || []).map(p => `${p.horizon}:${p.targetPrice}`).join(',')}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function blend(a, b, t) {
  return a + (b - a) * t;
}

export function nearLevel(price, level, pct = 0.025) {
  if (price == null || level == null || !level) return false;
  return Math.abs(price - level) / level <= pct;
}

export function sortedTargets(targets) {
  const order = { '1d': 1, '5d': 2, '30d': 3 };
  return [...(targets || [])].sort((a, b) => (order[a.horizon] || 99) - (order[b.horizon] || 99));
}

export function horizonAtDay(day) {
  if (day === 1) return '1d';
  if (day === 5) return '5d';
  if (day === 30) return '30d';
  return null;
}

export function historyTape(history, fallbackPrice) {
  const rows = (history || []).filter(c => c && c.close != null);
  const window = rows.slice(-90);
  const last = window[window.length - 1];
  const px = last?.close || fallbackPrice || 1;
  if (window.length < 4) {
    const r = 0.012;
    return {
      px,
      atr: px * 0.02,
      dailyStd: r,
      returns: [0.012, -0.008, 0.004, -0.011, 0.009, -0.003, 0.015, -0.007],
      shapes: [],
      upDayRate: 0.52,
      gapFreq: 0.22,
      gapAbs: 0.0015,
      autocorr: 0.05,
      streak: 0
    };
  }

  const rets = [];
  const shapes = [];
  const gaps = [];
  const trs = [];
  let upDays = 0;

  for (let i = 1; i < window.length; i++) {
    const c = window[i];
    const prev = window[i - 1];
    if (!prev.close) continue;
    const open = c.open != null ? c.open : prev.close;
    const high = c.high != null ? c.high : Math.max(open, c.close);
    const low = c.low != null ? c.low : Math.min(open, c.close);
    const bodyHigh = Math.max(open, c.close);
    const bodyLow = Math.min(open, c.close);
    const range = Math.max(high - low, px * 0.0008);
    const body = Math.abs(c.close - open);
    const ret = (c.close - prev.close) / prev.close;
    const gap = (open - prev.close) / prev.close;
    rets.push(ret);
    gaps.push(gap);
    trs.push(Math.max(high - low, Math.abs(high - prev.close), Math.abs(low - prev.close)));
    if (ret > 0) upDays++;
    shapes.push({
      ret,
      rangePct: range / prev.close,
      bodyFrac: clamp(body / range, 0, 1),
      upWickFrac: Math.max(0, high - bodyHigh) / range,
      dnWickFrac: Math.max(0, bodyLow - low) / range,
      gap,
      up: c.close >= open
    });
  }

  let autocorr = 0;
  if (rets.length > 8) {
    const m = mean(rets);
    let num = 0;
    let den = 0;
    for (let i = 1; i < rets.length; i++) num += (rets[i] - m) * (rets[i - 1] - m);
    for (const r of rets) den += (r - m) ** 2;
    autocorr = den ? num / den : 0;
  }

  let streak = 0;
  for (let i = rets.length - 1; i >= 0; i--) {
    const s = Math.sign(rets[i]);
    if (!s) break;
    if (streak === 0) streak = s;
    else if (Math.sign(streak) === s) streak += s;
    else break;
  }

  const atr = trs.length ? mean(trs.slice(-14)) : px * 0.02;
  const dailyStd = Math.max(stdev(rets), (atr / px) * 0.45, 0.004);

  return {
    px,
    atr,
    dailyStd,
    returns: rets,
    shapes,
    upDayRate: rets.length ? upDays / rets.length : 0.52,
    gapFreq: Math.min(0.55, gaps.filter(g => Math.abs(g) > 0.0008).length / Math.max(1, gaps.length)),
    gapAbs: Math.max(median(gaps.map(g => Math.abs(g))), 0.0008),
    autocorr: clamp(autocorr, -0.28, 0.38),
    streak
  };
}

function horizonScore(targets, horizon) {
  const p = (targets || []).find(t => t.horizon === horizon);
  return Number(p?.score) || 0;
}

function collectStructure(origin, anchors, pred, tape, targets) {
  const extras = [];
  const ind = pred?.indicators || {};
  const sig = pred?.signals || {};
  const news = Number(pred?.newsSentiment?.score || 0);
  const support = ind.support;
  const resistance = ind.resistance;
  const rsi = ind.rsi;
  const adx = ind.adx ?? 22;
  const atr = ind.atr || tape.atr || origin * 0.02;
  const sma20 = ind.sma20;
  const sma50 = ind.sma50;
  const sma200 = ind.sma200;
  const bb = ind.bb;
  const macdHist = ind.macd?.histogram;
  const week52 = ind.week52Position;
  const mfi = ind.mfi;
  const stoch = ind.stochK;

  const t1 = anchors.find(a => a.horizon === '1d');
  const t5 = anchors.find(a => a.horizon === '5d');
  const t30 = anchors.find(a => a.horizon === '30d');
  const net = (t30?.price ?? origin) - origin;
  const netDir = Math.sign(net);
  const conviction = clamp(Math.abs(horizonScore(targets, '30d') || horizonScore(targets, '5d') || 0.3), 0, 1);

  if (resistance && nearLevel(origin, resistance, 0.022)) {
    const through = t30 && t30.price > resistance * 1.012;
    const reject = !through || (rsi != null && rsi >= 72 && conviction < 0.55);
    if (reject && t5 && t5.day >= 4) {
      extras.push({ day: 3, price: resistance, kind: 'fade', exitWhy: 'fadeResistance' });
    } else if (through) {
      extras.push({ day: 2, price: resistance, kind: 'test' });
    }
  }
  if (support && nearLevel(origin, support, 0.022)) {
    const through = t30 && t30.price < support * 0.988;
    if (through) extras.push({ day: 2, price: support, kind: 'test' });
    else if (t5 && t5.day >= 4) {
      extras.push({ day: 3, price: support, kind: 'bounce', exitWhy: 'bounceSupport' });
    }
  }

  if (Math.abs(news) > 0.22 && t5) {
    const newsDir = Math.sign(news);
    const weekDir = Math.sign((t5.price - origin) || net);
    if (newsDir && t1 && Math.sign(t1.price - origin) === newsDir && Math.abs(news) > 0.4) {
      extras.push({
        day: 2,
        price: origin + (t1.price - origin) * (1.3 + Math.abs(news) * 0.25),
        kind: 'pullback'
      });
    } else if (newsDir && weekDir && newsDir !== weekDir) {
      extras.push({
        day: 2,
        price: origin * (1 + newsDir * Math.min(0.02, tape.dailyStd * 1.7)),
        kind: 'pullback'
      });
    }
  }

  if (t5 && t30 && t30.day - t5.day >= 12 && Math.abs(net) > atr * 2) {
    let retrace = 0.38;
    if (rsi != null && rsi >= 70) retrace = 0.52;
    else if (rsi != null && rsi >= 62) retrace = 0.44;
    else if (rsi != null && rsi <= 32) retrace = 0.22;
    if (mfi != null && mfi >= 80) retrace += 0.05;
    if (stoch != null && stoch >= 80) retrace += 0.04;
    if (bb?.pctB != null && bb.pctB >= 0.88) retrace += 0.06;
    if (bb?.pctB != null && bb.pctB <= 0.12) retrace -= 0.08;
    if (adx >= 32) retrace *= 0.7;
    else if (adx > 0 && adx < 18) retrace = Math.min(0.62, retrace + 0.14);
    if (week52 != null && week52 > 0.96) retrace += 0.05;
    retrace *= 1.12 - conviction * 0.32;
    if (macdHist != null && netDir > 0 && macdHist < 0) retrace += 0.06;
    if (macdHist != null && netDir < 0 && macdHist > 0) retrace += 0.06;
    if (sig.volume_trend < -0.4 && netDir > 0) retrace += 0.05;
    if (sig.momentum > 0.4 && netDir > 0) retrace -= 0.04;
    retrace = clamp(retrace, 0.2, 0.62);

    const peak = t5.price;
    let price = peak - net * retrace;
    if (netDir > 0) {
      const magnets = [sma20, sma50, support, bb?.middle].filter(p => p != null && p < peak && p > origin * 0.93);
      if (magnets.length) {
        const mag = magnets.reduce((best, p) => (Math.abs(p - price) < Math.abs(best - price) ? p : best));
        price = blend(price, mag, 0.5);
      }
      if (support != null) price = Math.max(price, support * 0.994);
    } else if (netDir < 0) {
      const magnets = [sma20, sma50, resistance, bb?.middle].filter(p => p != null && p > peak && p < origin * 1.07);
      if (magnets.length) {
        const mag = magnets.reduce((best, p) => (Math.abs(p - price) < Math.abs(best - price) ? p : best));
        price = blend(price, mag, 0.5);
      }
      if (resistance != null) price = Math.min(price, resistance * 1.006);
    }

    const frac = adx >= 30 ? 0.32 : adx < 18 ? 0.45 : 0.38;
    extras.push({
      day: clamp(t5.day + Math.round((t30.day - t5.day) * frac), t5.day + 4, t30.day - 4),
      price,
      kind: 'resume',
      exitWhy: rsi != null && rsi >= 70 && netDir > 0
        ? 'overbought'
        : rsi != null && rsi <= 30 && netDir < 0
          ? 'oversold'
          : null
    });
  }

  if (sma200 && t30 && (origin - sma200) * (t30.price - sma200) < 0) {
    const span = Math.max(Math.abs(t30.price - origin), atr);
    extras.push({
      day: clamp(Math.round(t30.day * Math.abs(sma200 - origin) / span), 6, 24),
      price: sma200,
      kind: 'test'
    });
  }

  if (adx > 0 && adx < 18 && t30 && Math.abs(net) > atr) {
    extras.push({
      day: 8,
      price: origin - netDir * atr * 0.75,
      kind: 'pullback'
    });
  }

  const digest = extras.find(e => e.kind === 'resume' || e.kind === 'pullback');
  if (t30 && digest && t30.day - digest.day >= 12 && Math.abs(t30.price - digest.price) > atr * 2.4) {
    extras.push({
      day: clamp(digest.day + Math.round((t30.day - digest.day) * 0.55), digest.day + 5, t30.day - 4),
      price: blend(digest.price, t30.price, 0.62) * (1 - (netDir || 1) * 0.01),
      kind: 'pullback'
    });
  }

  return extras;
}

export function forecastAnchors(lastClose, targets, pred, tape) {
  const anchors = [{ day: 0, price: lastClose, kind: 'now' }];
  const seen = new Set([0]);
  for (const p of sortedTargets(targets)) {
    const day = HORIZON_DAYS[p.horizon];
    if (day == null || seen.has(day) || p.targetPrice == null) continue;
    seen.add(day);
    anchors.push({ day, price: p.targetPrice, kind: 'horizon', horizon: p.horizon });
  }
  if (anchors.length < 2) return anchors;

  for (const ex of collectStructure(lastClose, anchors, pred, tape, targets)) {
    if (ex.day <= 0 || ex.day >= FORECAST_DAYS) continue;
    if (anchors.some(a => a.day === ex.day)) continue;
    if (anchors.some(a => a.kind !== 'horizon' && a.kind !== 'now' && Math.abs(a.day - ex.day) < 3)) continue;
    anchors.push(ex);
  }
  anchors.sort((a, b) => a.day - b.day || (a.kind === 'horizon' ? 1 : 0) - (b.kind === 'horizon' ? 1 : 0));
  return anchors;
}

function bootstrapBlock(tape, rng, remaining) {
  const rets = tape.returns || [];
  const n = Math.min(remaining, 2 + Math.floor(rng() * 3));
  if (rets.length < 5) {
    return Array.from({ length: n }, () => {
      const u = rng() || 1e-9;
      const v = rng() || 1e-9;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * (tape.dailyStd || 0.01);
    });
  }
  const start = Math.floor(rng() * Math.max(1, rets.length - n));
  return rets.slice(start, start + n);
}

function brownianBridge(start, end, steps, tape, rng, ctx = {}) {
  if (steps <= 0) return [];
  if (steps === 1) return [end];

  const raw = [start];
  let price = start;
  let run = ctx.startStreak || 0;
  let i = 0;
  const persist = clamp(0.16 + (ctx.adx || 22) / 140 + (tape.autocorr || 0) * 0.45, 0.08, 0.52);
  const cap = Math.max(tape.dailyStd * 2.9, 0.014);

  while (i < steps) {
    const block = bootstrapBlock(tape, rng, steps - i);
    for (const base of block) {
      if (i >= steps) break;
      let r = base;
      if (run !== 0 && rng() < persist) r = Math.sign(run) * Math.abs(r);
      if (Math.abs(run) >= 3 && rng() < 0.4 + Math.min(0.22, Math.abs(run) * 0.045)) {
        r = -Math.sign(run) * Math.abs(r);
      }
      const day = (ctx.day0 || 0) + i + 1;
      if (day <= 3 && ctx.news) r += ctx.news * 0.0045 * (1.15 - day * 0.25);
      if (ctx.resistance && price > ctx.resistance * 0.992 && price < ctx.resistance * 1.01 && r > 0) r *= 0.38;
      if (ctx.support && price < ctx.support * 1.008 && price > ctx.support * 0.99 && r < 0) r *= 0.38;
      r = clamp(r, -cap, cap);
      price = Math.max(start * 0.25, price * (1 + r));
      raw.push(price);
      const s = Math.sign(r);
      run = !s ? 0 : Math.sign(run) === s ? run + s : s;
      i++;
    }
  }

  const out = [];
  const logEndWant = Math.log(Math.max(end, 1e-9));
  const logEndHave = Math.log(Math.max(raw[steps], 1e-9));
  const err = logEndWant - logEndHave;
  for (let k = 1; k <= steps; k++) {
    out.push(Math.exp(Math.log(Math.max(raw[k], 1e-9)) + err * (k / steps)));
  }
  out[steps - 1] = end;
  return out;
}

function forecastCloses(lastClose, anchors, tape, rng, pred) {
  const closes = [lastClose];
  let price = lastClose;
  let day = 0;
  let streak = tape.streak || 0;
  const ctxBase = {
    adx: pred?.indicators?.adx ?? 22,
    news: Number(pred?.newsSentiment?.score || 0),
    resistance: pred?.indicators?.resistance,
    support: pred?.indicators?.support
  };

  for (let i = 1; i < anchors.length; i++) {
    const span = anchors[i].day - day;
    if (span <= 0) continue;
    const next = brownianBridge(price, anchors[i].price, span, tape, rng, {
      ...ctxBase,
      day0: day,
      startStreak: streak
    });
    for (const p of next) closes.push(p);
    price = anchors[i].price;
    day = anchors[i].day;
    if (closes.length >= 2) streak = Math.sign(closes[closes.length - 1] - closes[closes.length - 2]) || 0;
  }
  if (day < FORECAST_DAYS) {
    const tail = brownianBridge(price, price, FORECAST_DAYS - day, tape, rng, {
      ...ctxBase,
      day0: day,
      startStreak: streak
    });
    for (const p of tail) closes.push(p);
  }
  return closes.slice(0, FORECAST_DAYS + 1);
}

function sessionCandle(prevClose, close, tape, rng) {
  const ret = prevClose ? (close - prevClose) / prevClose : 0;
  const shapes = tape.shapes || [];
  let pool = shapes.filter(s => Math.sign(s.ret) === Math.sign(ret) || Math.abs(ret) < 0.0015);
  const mag = Math.abs(ret);
  const closeMag = pool.filter(s => Math.abs(Math.abs(s.ret) - mag) < Math.max(0.007, mag * 0.85));
  if (closeMag.length >= 3) pool = closeMag;
  if (!pool.length) pool = shapes;
  const shape = pool.length ? pool[Math.floor(rng() * pool.length)] : null;

  const gap = shape && rng() < tape.gapFreq
    ? shape.gap * (0.35 + rng() * 1.25)
    : (rng() < (tape.gapFreq || 0) * 0.45 ? (rng() * 2 - 1) * (tape.gapAbs || 0.001) : 0);
  const open = prevClose * (1 + gap);
  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const body = bodyHigh - bodyLow;
  let rangePct = shape ? shape.rangePct : Math.max(Math.abs(ret) * 1.65, (tape.dailyStd || 0.01) * 1.25);
  let range = Math.max(body, prevClose * rangePct);
  if (rng() < 0.22) range *= 1.12 + rng() * 0.4;

  const extra = Math.max(0, range - body);
  const wickSum = shape ? shape.upWickFrac + shape.dnWickFrac : 0;
  let upFrac = wickSum > 1e-6 ? shape.upWickFrac / wickSum : 0.5;
  if (!Number.isFinite(upFrac)) upFrac = 0.5;
  const up = extra * clamp(0.22 + rng() * 0.18 + upFrac * 0.6, 0.12, 0.88);
  const dn = extra - up;

  return {
    open,
    close,
    high: bodyHigh + up,
    low: Math.max(close * 0.15, bodyLow - dn)
  };
}

export function buildForecastPath({ lastCandle, targets, history, pred, symbol }) {
  if (!lastCandle || !targets?.length) return { bars: [], anchors: [] };
  const tape = historyTape(history, lastCandle.close);
  const anchors = forecastAnchors(lastCandle.close, targets, pred, tape);
  if (anchors.length < 2) return { bars: [], anchors: [] };
  const rng = seedRng(symbol, lastCandle.close, targets);
  const closes = forecastCloses(lastCandle.close, anchors, tape, rng, pred);
  const bars = [];
  for (let day = 1; day < closes.length && day <= FORECAST_DAYS; day++) {
    bars.push({
      day,
      horizon: horizonAtDay(day),
      ...sessionCandle(closes[day - 1], closes[day], tape, rng)
    });
  }
  return { bars, anchors };
}
