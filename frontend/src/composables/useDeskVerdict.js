import { computed, unref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePredictionStore } from '../stores/predictionStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { formatPct, formatPrice } from '../utils/format.js';
import { simpleReasons } from '../utils/picks.js';

function toAction(p) {
  if (p === 'UP' || p === 'BUY' || p === 'LONG') return 'buy';
  if (p === 'DOWN' || p === 'SELL' || p === 'SHORT') return 'sell';
  return 'hold';
}

function readSource(source) {
  return typeof source === 'function' ? source() : unref(source);
}

export function useDeskVerdict(symbolSource) {
  const predictionStore = usePredictionStore();
  const ui = useUiStore();
  const { t } = useI18n();

  const symbol = computed(() => String(readSource(symbolSource) || '').toUpperCase());

  const prediction = computed(() => {
    const key = symbol.value;
    const current = predictionStore.currentPrediction;
    if (current?.ticker === key) return current;
    return predictionStore.byTicker?.[key] || null;
  });

  function confidenceLabel(n) {
    if (n >= 70) return t('confidence.high');
    if (n >= 50) return t('confidence.medium');
    return t('confidence.low');
  }

  const verdict = computed(() => {
    const pred = prediction.value;
    if (!pred?.predictions?.length) return null;

    const ai = pred.ai;
    const fiveDay = pred.predictions.find(p => p.horizon === '5d') || pred.predictions[1];
    const action = ai?.action
      ? toAction(ai.action)
      : pred.tradePlan?.direction === 'LONG' ? 'buy'
        : pred.tradePlan?.direction === 'SHORT' ? 'sell'
        : toAction(fiveDay?.prediction);

    const styles = {
      buy: { label: t('action.buy'), bg: 'bg-bull/15 text-bull border border-bull/30' },
      sell: { label: t('action.sell'), bg: 'bg-bear/15 text-bear border border-bear/30' },
      hold: { label: t('action.hold'), bg: 'bg-neutral/10 text-neutral border border-neutral/30' }
    };
    const s = styles[action];

    const fallback = {
      buy: t('verdict.fallbackBuy', { symbol: symbol.value }),
      sell: t('verdict.fallbackSell', { symbol: symbol.value }),
      hold: t('verdict.fallbackHold', { symbol: symbol.value })
    };

    const newsN = pred.newsUsed ?? pred.newsSentiment?.articleCount;
    const headline = ai?.thesis || fallback[action];
    const rawWhy = ui.isSimple
      ? (ai?.why?.length ? ai.why : simpleReasons(pred.reasons || []))
      : (ai?.why || pred.reasons?.slice(0, 5) || []);
    const why = ui.isSimple
      ? rawWhy.filter(w => !/\b(macd|adx|rsi|sma|ema|stochastic|bollinger)\b/i.test(w))
      : rawWhy;
    const risks = ai?.risks || [];

    const chips = [];
    if (ai) {
      chips.push(ui.isSimple
        ? t('confidence.label', { level: confidenceLabel(ai.conviction) })
        : t('verdict.llamaMeta', { pct: ai.conviction }));
      if (!ui.isSimple && ai.disagreement === 'news_vs_tech') chips.push(t('verdict.newsVsTape'));
      if (newsN != null) chips.push(t('verdict.headlines', { n: newsN }));
    } else if (pred.aiError) {
      chips.push(t('verdict.llamaOffline', { reason: pred.reasons?.[0] || t('verdict.quantOnly') }));
    }

    return {
      action,
      label: s.label,
      bg: s.bg,
      headline,
      doNow: ai?.doNow || '',
      chips,
      detail: chips.join(' · ') || null,
      why,
      risks,
      sources: (pred.sources || []).filter(s => s?.title && s?.url),
      digest: String(pred.sourcesDigest || '').trim(),
      briefing: pred.briefing || null,
      overlooked: pred.overlooked || pred.ai?.overlooked || [],
      teaser: (pred.briefing?.considered || []).slice(0, 4).map(c => c.value).filter(Boolean).join(' · '),
      canExpand: !!(headline || why.length || risks.length || pred.sourcesDigest || pred.briefing || pred.overlooked?.length)
    };
  });

  const horizons = computed(() => {
    const preds = prediction.value?.predictions;
    if (!preds?.length) return [];
    const labels = { '1d': '1d', '5d': '5d', '30d': '30d' };
    return preds.map(p => ({
      horizon: p.horizon,
      label: labels[p.horizon] || p.horizon,
      prediction: p.prediction,
      price: formatPrice(p.targetPrice),
      low: p.low != null ? formatPrice(p.low) : null,
      high: p.high != null ? formatPrice(p.high) : null,
      move: formatPct(p.expectedMovePct, 1),
      confidence: p.confidence != null ? Math.round(p.confidence * 100) : null,
      color: p.prediction === 'UP' ? 'text-bull' : p.prediction === 'DOWN' ? 'text-bear' : 'text-neutral',
      border: p.prediction === 'UP' ? 'border-bull/25' : p.prediction === 'DOWN' ? 'border-bear/25' : 'border-surface-300'
    }));
  });

  return { prediction, verdict, horizons };
}
