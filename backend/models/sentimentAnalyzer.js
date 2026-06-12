// Financial news analysis: market-moving EVENT detection + lexicon sentiment,
// weighted by source credibility, recency, and ticker relevance.
//
// Event detection is what separates "this headline sounds positive" from
// "this is an analyst upgrade, which historically moves a stock 1-3% next day".
// Each event carries a typical impact magnitude (rough expected % move drift).

const EVENT_PATTERNS = [
  // Earnings & guidance — the biggest single-day movers
  { id: 'earnings_beat', label: 'Earnings Beat', impact: 2.5, re: /\b(beats?|beat|tops?|topped|exceed(s|ed)?)\b.{0,40}\b(estimates?|expectations?|forecasts?|consensus|street)\b|earnings beat|blowout (quarter|earnings)|record (quarterly )?(revenue|profit|earnings)/i },
  { id: 'earnings_miss', label: 'Earnings Miss', impact: -2.8, re: /\b(miss(es|ed)?)\b.{0,40}\b(estimates?|expectations?|forecasts?|consensus|street)\b|earnings miss|falls? short of (estimates|expectations|forecasts)|disappointing (quarter|earnings|results)/i },
  { id: 'guidance_raise', label: 'Guidance Raised', impact: 2.2, re: /\b(raises?|raised|hikes?|hiked|boosts?|boosted|lifts?|lifted)\b.{0,30}\b(guidance|outlook|forecast|targets?)\b|guidance raised/i },
  { id: 'guidance_cut', label: 'Guidance Cut', impact: -2.6, re: /\b(cuts?|cut|lowers?|lowered|slashe?s?d?|trims?|trimmed|withdraws?|withdrew)\b.{0,30}\b(guidance|outlook|forecast)\b|profit warning/i },

  // Analyst actions
  { id: 'upgrade', label: 'Analyst Upgrade', impact: 1.6, re: /\bupgrade[ds]?\b|raised? to (buy|overweight|outperform|strong buy)|initiat(es?|ed) .{0,30}(buy|overweight|outperform)|price target (raised|hiked|boosted|lifted|increased)/i },
  { id: 'downgrade', label: 'Analyst Downgrade', impact: -1.7, re: /\bdowngrade[ds]?\b|cut to (sell|underweight|underperform|neutral|hold)|price target (cut|lowered|slashed|reduced|trimmed)/i },

  // Corporate actions
  { id: 'mna', label: 'M&A / Takeover', impact: 1.8, re: /\b(acquir(es?|ed|ing|sition)|merger|takeover|buyout|tender offer)\b|to (buy|purchase) .{0,40} for \$|\bgoes? private\b/i },
  { id: 'buyback', label: 'Buyback', impact: 1.3, re: /\b(buyback|share repurchase|repurchase program)\b/i },
  { id: 'dividend_up', label: 'Dividend Raise', impact: 1.0, re: /\b(raises?|raised|hikes?|hiked|boosts?|increases?)\b.{0,25}\bdividend\b|dividend (increase|hike|raise)|special dividend/i },
  { id: 'dividend_cut', label: 'Dividend Cut', impact: -2.2, re: /\b(cuts?|cut|suspends?|suspended|slashe?s?d?|eliminates?)\b.{0,25}\bdividend\b/i },
  { id: 'stock_split', label: 'Stock Split', impact: 0.8, re: /\bstock split\b|announces? .{0,15}-for-.{0,5} split/i },

  // Regulatory / legal
  { id: 'fda_positive', label: 'FDA / Approval', impact: 2.4, re: /fda (approv(al|es?|ed)|clearance|fast.?track|breakthrough)|approval granted|wins? approval|(receives?|granted) (fda )?approval/i },
  { id: 'fda_negative', label: 'FDA Setback', impact: -2.6, re: /fda (reject(s|ed|ion)?|declin(es|ed)|warning letter)|complete response letter|\brecall(s|ed)?\b|clinical (hold|failure)|trial fail(s|ed|ure)/i },
  { id: 'lawsuit', label: 'Lawsuit / Probe', impact: -1.4, re: /\blawsuits?\b|\bsue[sd]?\b|class action|antitrust|\bprobes?\b|investigat(es?|ed|ion|ing)|subpoena|\bindicted?\b|fraud charges|sec charges/i },
  { id: 'fine', label: 'Fine / Penalty', impact: -1.2, re: /\b(fine[sd]?|penalt(y|ies))\b.{0,30}\b(million|billion)\b|pays? .{0,20}(settle|settlement)/i },

  // Company events
  { id: 'ceo_exit', label: 'CEO Change', impact: -1.0, re: /\b(ceo|chief executive|cfo|chief financial)\b.{0,40}\b(steps? down|resign(s|ed|ation)?|departs?|exits?|fired|ousted|retir(es|ing))\b/i },
  { id: 'layoffs', label: 'Layoffs', impact: -0.6, re: /\blayoffs?\b|job cuts|cuts? .{0,15}(jobs|workforce|staff)|workforce reduction/i },
  { id: 'bankruptcy', label: 'Bankruptcy Risk', impact: -3.5, re: /\bbankruptcy\b|chapter 11|chapter 7|insolven(t|cy)|going.?concern (doubt|warning)|debt restructuring/i },
  { id: 'short_report', label: 'Short-Seller Report', impact: -2.4, re: /short.?sellers? (report|target)|hindenburg|muddy waters|citron research|kerrisdale|short report/i },
  { id: 'insider_buy', label: 'Insider Buying', impact: 1.1, re: /insiders? (buy(s|ing)?|bought|purchas(es?|ed|ing))|(ceo|cfo|director) (buys?|bought|purchas(es|ed))/i },

  // Growth catalysts
  { id: 'contract_win', label: 'Contract Win', impact: 1.4, re: /\bwins?\b.{0,25}\b(contract|order|deal)\b|awarded .{0,30}contract|secures? .{0,25}(contract|order|deal)/i },
  { id: 'partnership', label: 'Partnership', impact: 0.9, re: /\bpartnership\b|partners? with|teams? up with|collaboration with|joint venture|strategic alliance/i },
  { id: 'product_launch', label: 'Product Launch', impact: 0.7, re: /\b(launch(es|ed)?|unveil(s|ed)?|introduc(es|ed)|debuts?)\b.{0,40}\b(new|next.?gen|flagship|ai)\b/i },
  { id: 'expansion', label: 'Expansion', impact: 0.8, re: /\bexpand(s|ed|ing|sion)\b.{0,30}\b(production|capacity|operations|into)\b|new (factory|plant|facility)|invest(s|ing)? \$.{0,15}(billion|million) in/i }
];

const BULLISH_WORDS = new Set([
  'surge', 'surged', 'surges', 'rally', 'rallied', 'rallies', 'soar', 'soared', 'soars',
  'rise', 'rises', 'rose', 'gain', 'gains', 'gained', 'jump', 'jumps', 'jumped',
  'climb', 'climbs', 'climbed', 'beat', 'beats', 'bullish', 'growth', 'profit',
  'exceed', 'exceeds', 'outperform', 'outperforms', 'strong', 'stronger', 'strongest',
  'upgrade', 'overweight', 'breakout', 'momentum', 'accelerate', 'accelerates',
  'positive', 'upbeat', 'optimistic', 'expansion', 'recovery', 'rebound', 'rebounds',
  'breakthrough', 'innovation', 'dividend', 'approve', 'approved', 'win', 'won', 'wins',
  'profitable', 'surplus', 'boost', 'boosted', 'boosts', 'upside', 'record', 'high',
  'milestone', 'robust', 'resilient', 'outpace', 'thriving', 'demand'
]);

const BEARISH_WORDS = new Set([
  'crash', 'crashed', 'crashes', 'plunge', 'plunged', 'plunges', 'fall', 'falls', 'fell',
  'drop', 'drops', 'dropped', 'decline', 'declines', 'declined', 'tumble', 'tumbled',
  'sink', 'sinks', 'sank', 'slump', 'slumped', 'slumps', 'bearish', 'loss', 'losses',
  'miss', 'misses', 'missed', 'underperform', 'weak', 'weaker', 'weakest', 'downgrade',
  'sell', 'selloff', 'sell-off', 'underweight', 'breakdown', 'recession', 'contraction',
  'layoff', 'layoffs', 'negative', 'pessimistic', 'risk', 'risks', 'concern', 'concerns',
  'uncertainty', 'lawsuit', 'investigation', 'fraud', 'bankruptcy', 'default', 'fine',
  'penalty', 'probe', 'recall', 'shortage', 'deficit', 'warning', 'warns', 'warned',
  'cautious', 'headwinds', 'slowdown', 'disappointing', 'struggles', 'struggling',
  'tariff', 'tariffs', 'inflation', 'low', 'fears', 'fear', 'worries', 'turmoil'
]);

// Intensifiers that boost the weight of the next sentiment word
const INTENSIFIERS = new Set([
  'significantly', 'sharply', 'dramatically', 'substantially', 'massively',
  'unexpectedly', 'surprisingly', 'severely', 'strongly', 'heavily', 'wildly'
]);

// Negations that flip sentiment
const NEGATIONS = new Set([
  'not', 'no', "n't", 'never', 'neither', 'barely', 'hardly', 'fails', 'failed',
  'despite', 'without'
]);

// Source credibility: major wires move markets; aggregators and blogs less so.
const SOURCE_WEIGHTS = [
  [/reuters/i, 1.3], [/bloomberg/i, 1.3], [/wall street journal|wsj/i, 1.25],
  [/financial times|ft\.com/i, 1.25], [/cnbc/i, 1.15], [/barron/i, 1.15],
  [/marketwatch/i, 1.1], [/associated press|ap news/i, 1.15], [/forbes/i, 1.0],
  [/yahoo/i, 1.0], [/investor'?s business daily|ibd/i, 1.05], [/benzinga/i, 0.9],
  [/seeking ?alpha/i, 0.9], [/motley ?fool/i, 0.75], [/zacks/i, 0.85],
  [/insidermonkey|gurufocus|simplywall/i, 0.7]
];

function sourceWeight(source) {
  if (!source) return 1.0;
  for (const [re, w] of SOURCE_WEIGHTS) {
    if (re.test(source)) return w;
  }
  return 1.0;
}

// Recency: news decays fast. Half-life ≈ 24h, floor at 0.12 (week-old news barely counts).
function recencyWeight(publishedAt) {
  if (!publishedAt) return 0.5;
  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 3600000);
  return Math.max(0.12, Math.exp(-ageHours / 34));
}

export function detectEvents(text) {
  if (!text) return [];
  const events = [];
  for (const ev of EVENT_PATTERNS) {
    if (ev.re.test(text)) events.push({ id: ev.id, label: ev.label, impact: ev.impact });
  }
  return events;
}

export function analyzeSentiment(text) {
  if (!text) return { score: 0, label: 'neutral', confidence: 0, matchCount: 0 };

  const lower = text.toLowerCase();
  let score = 0;
  let matchCount = 0;

  // Tokenize and check individual words
  const tokens = lower.split(/[\s,.!?;:()"']+/).filter(Boolean);
  let negateNext = false;
  let intensifyNext = false;

  tokens.forEach(token => {
    if (NEGATIONS.has(token)) { negateNext = true; return; }
    if (INTENSIFIERS.has(token)) { intensifyNext = true; return; }

    let wordScore = 0;
    if (BULLISH_WORDS.has(token)) wordScore = 1;
    else if (BEARISH_WORDS.has(token)) wordScore = -1;

    if (wordScore !== 0) {
      if (intensifyNext) wordScore *= 1.8;
      if (negateNext) wordScore *= -1;
      score += wordScore;
      matchCount++;
    }

    negateNext = false;
    intensifyNext = false;
  });

  // Normalize score to [-1, 1]
  const normalizedScore = matchCount > 0
    ? Math.max(-1, Math.min(1, score / Math.max(matchCount, 3)))
    : 0;

  const confidence = Math.min(1, matchCount / 5);
  const label = normalizedScore > 0.15 ? 'bullish'
    : normalizedScore < -0.15 ? 'bearish'
    : 'neutral';

  return { score: normalizedScore, label, confidence, matchCount };
}

// Full per-article analysis: lexicon tone + detected events combined into one
// score, with the article's own weight (source × recency) attached.
export function analyzeArticle(article, ticker = null) {
  const headline = article.headline || article.title || '';
  const body = article.summary || article.description || '';
  const fullText = `${headline}. ${body}`;

  const titleSent = analyzeSentiment(headline);
  const bodySent = analyzeSentiment(body);
  const toneScore = titleSent.score * 0.65 + bodySent.score * 0.35;

  const events = detectEvents(fullText);
  // Event score: sum of impacts squashed into [-1, 1]; events outweigh tone.
  const eventImpact = events.reduce((a, e) => a + e.impact, 0);
  const eventScore = Math.max(-1, Math.min(1, eventImpact / 3));

  const score = events.length > 0
    ? eventScore * 0.7 + toneScore * 0.3
    : toneScore;

  // Relevance: does the headline actually mention this ticker/company?
  let relevance = 1.0;
  if (ticker) {
    const t = ticker.toUpperCase();
    const inHeadline = headline.toUpperCase().includes(t);
    const inBody = body.toUpperCase().includes(t);
    relevance = inHeadline ? 1.0 : inBody ? 0.75 : 0.55;
  }

  const weight = sourceWeight(article.source) * recencyWeight(article.publishedAt) * relevance;
  const label = score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral';

  return {
    score,
    label,
    events,
    eventImpact,
    weight,
    confidence: Math.min(1, (titleSent.matchCount + bodySent.matchCount + events.length * 2) / 5)
  };
}

// Aggregate a set of articles into one sentiment + impact estimate.
// Returns:
//   score: weighted tone in [-1, 1]
//   impactPct: rough expected short-term % drift implied by detected events
//   buzz: article flow last 24h vs the prior daily average (>1.5 = unusual attention)
//   topEvents: most impactful events found, for display
export function analyzeArticles(articles, ticker = null) {
  if (!articles || articles.length === 0) {
    return { score: 0, label: 'neutral', impactPct: 0, buzz: 0, topEvents: [], articleCount: 0, articles: [] };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  let impactSum = 0;
  const eventTally = new Map();

  const analyzed = articles.map(article => {
    const a = analyzeArticle(article, ticker);
    weightedSum += a.score * a.weight;
    totalWeight += a.weight;
    // Impact decays with recency too — yesterday's beat is mostly priced in
    impactSum += a.eventImpact * recencyWeight(article.publishedAt) * sourceWeight(article.source);
    for (const ev of a.events) {
      const cur = eventTally.get(ev.id) || { ...ev, count: 0 };
      cur.count++;
      eventTally.set(ev.id, cur);
    }
    return {
      ...article,
      sentiment: { score: a.score, label: a.label },
      events: a.events
    };
  });

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Buzz: articles in last 24h vs daily average over the rest of the window
  const now = Date.now();
  const last24 = articles.filter(a => now - new Date(a.publishedAt).getTime() < 86400000).length;
  const olderDays = Math.max(1, (now - Math.min(...articles.map(a => new Date(a.publishedAt).getTime() || now))) / 86400000 - 1);
  const olderPerDay = Math.max(0.5, (articles.length - last24) / olderDays);
  const buzz = parseFloat((last24 / olderPerDay).toFixed(2));

  const topEvents = [...eventTally.values()]
    .sort((a, b) => Math.abs(b.impact) * b.count - Math.abs(a.impact) * a.count)
    .slice(0, 5);

  // Cap the implied drift at ±6% — beyond that we're guessing
  const impactPct = Math.max(-6, Math.min(6, impactSum * 0.45));

  return {
    score,
    label: score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral',
    impactPct: parseFloat(impactPct.toFixed(2)),
    buzz,
    topEvents,
    articleCount: articles.length,
    articles: analyzed
  };
}
