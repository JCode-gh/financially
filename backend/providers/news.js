import { getMarketNews as getFinnhubMarketNews, getStockNews as getFinnhubStockNews, getStockNewsHistory as getFinnhubStockNewsHistory } from '../services/finnhub.js';
import { getTopFinancialNews, searchStockNews } from '../services/newsApi.js';
import { getRssMarketNews, getRssStockNews, getGoogleStockNews } from '../services/rssNews.js';
import { analyzeArticles } from '../models/sentimentAnalyzer.js';
import { createTtlCache } from '../lib/cache.js';
import { dedupeArticles, filterForTicker, isPersonalNoise, rankForWatchlist } from '../lib/articles.js';
import { isInternationalTicker } from '../services/symbolFormat.js';

const newsCache = createTtlCache();
const { cached } = newsCache;

async function pLimit(tasks, n) {
  const out = [];
  for (let i = 0; i < tasks.length; i += n) {
    const chunk = await Promise.all(tasks.slice(i, i + n).map(fn => fn()));
    out.push(...chunk);
  }
  return out;
}

export async function getStockArticles(ticker, name, { deep = true } = {}) {
  const jobs = [getRssStockNews(ticker), getGoogleStockNews(ticker, name)];
  if (deep) jobs.unshift(getFinnhubStockNews(ticker));

  const settled = await Promise.allSettled(jobs);
  let articles = filterForTicker(dedupeArticles(
    settled.flatMap(r => (r.status === 'fulfilled' && r.value ? r.value : []))
  ), ticker, name);

  if (deep && articles.length < 4) {
    const extra = await searchStockNews(ticker, name).catch(() => []);
    articles = filterForTicker(dedupeArticles([...articles, ...(extra || [])]), ticker, name);
  }
  return articles;
}

export async function getMarketNewsBundle(tickers = []) {
  const key = `market_news_${tickers.map(t => t.symbol || t).join(',')}`;
  return cached(key, 180_000, async () => {
    const normalized = tickers.map(t => (typeof t === 'string' ? { symbol: t } : t)).filter(t => t.symbol);
    const intl = normalized.filter(t => isInternationalTicker(t.symbol)).slice(0, 16);

    const [finnhub, rss, newsApi, perTicker] = await Promise.allSettled([
      getFinnhubMarketNews('general'),
      getRssMarketNews(),
      getTopFinancialNews(),
      intl.length
        ? pLimit(intl.map(t => () => getStockArticles(t.symbol, t.name, { deep: false })), 4)
        : Promise.resolve([])
    ]);

    const raw = dedupeArticles([
      ...(finnhub.status === 'fulfilled' ? finnhub.value || [] : []),
      ...(rss.status === 'fulfilled' ? rss.value || [] : []),
      ...(newsApi.status === 'fulfilled' ? newsApi.value || [] : []),
      ...(perTicker.status === 'fulfilled'
        ? (perTicker.value || []).flatMap(list => (list || []).slice(0, 8))
        : [])
    ]);

    const articles = rankForWatchlist(raw, normalized).slice(0, 60);
    const { articles: analyzed, score, label } = analyzeArticles(articles);
    return { articles: analyzed, marketSentiment: { score, label }, count: analyzed.length };
  });
}

export async function getStockNewsBundle(ticker, name) {
  const key = `stock_news_${ticker}_${name || ''}`;
  const bundle = await cached(key, 120_000, async () => {
    const articles = await getStockArticles(ticker, name);
    const { articles: analyzed, score, label, impactPct, buzz, topEvents } = analyzeArticles(articles, ticker);
    return {
      articles: analyzed,
      stockSentiment: { ticker, score, label, impactPct, buzz, topEvents },
      count: analyzed.length
    };
  });
  if (!bundle.count) newsCache.cache.delete(key);
  return bundle;
}

export async function getStockChartNews(ticker, days = 400) {
  const span = Math.min(Math.max(Number(days) || 400, 30), 400);
  const key = `stock_chart_news_${ticker}_${span}`;
  return cached(key, 180_000, async () => {
    const raw = await getFinnhubStockNewsHistory(ticker, span);
    const articles = dedupeArticles(raw || []).filter(a => !isPersonalNoise(a));
    const { articles: analyzed } = analyzeArticles(articles, ticker);
    return analyzed;
  });
}
