// Keyword-based financial sentiment analysis with phrase detection

const BULLISH_PHRASES = [
  'earnings beat', 'revenue growth', 'guidance raised', 'margin expansion',
  'record high', 'all-time high', 'strong demand', 'market share gains',
  'buyback program', 'special dividend', 'raised outlook', 'upgraded to buy',
  'price target raised', 'better than expected', 'blowout quarter'
];

const BEARISH_PHRASES = [
  'earnings miss', 'revenue decline', 'guidance cut', 'margin compression',
  'all-time low', 'weak demand', 'market share loss', 'regulatory probe',
  'class action', 'bankruptcy filing', 'credit downgrade', 'downgraded to sell',
  'price target cut', 'worse than expected', 'disappointing quarter',
  'layoff announcement', 'mass layoffs', 'profit warning'
];

const BULLISH_WORDS = new Set([
  'surge', 'surged', 'rally', 'rallied', 'soar', 'soared', 'rise', 'rose',
  'gain', 'gained', 'jump', 'jumped', 'climb', 'climbed', 'beat', 'beats',
  'bullish', 'growth', 'profit', 'exceed', 'exceeds', 'outperform',
  'strong', 'upgrade', 'overweight', 'breakout', 'momentum', 'accelerate',
  'positive', 'upbeat', 'optimistic', 'expansion', 'recovery', 'rebound',
  'breakthrough', 'innovation', 'partnership', 'acquisition', 'dividend',
  'approve', 'approved', 'launch', 'launched', 'win', 'won', 'profit',
  'profitable', 'surplus', 'boost', 'boosted', 'upside', 'record'
]);

const BEARISH_WORDS = new Set([
  'crash', 'crashed', 'plunge', 'plunged', 'fall', 'fell', 'drop', 'dropped',
  'decline', 'declined', 'tumble', 'tumbled', 'sink', 'sank', 'slump', 'slumped',
  'bearish', 'loss', 'miss', 'misses', 'underperform', 'weak', 'downgrade',
  'sell', 'underweight', 'breakdown', 'recession', 'contraction', 'layoff',
  'cut', 'cuts', 'negative', 'pessimistic', 'risk', 'concern', 'uncertainty',
  'lawsuit', 'investigation', 'fraud', 'bankruptcy', 'default', 'debt',
  'fine', 'penalty', 'probe', 'recall', 'shortage', 'deficit', 'loss',
  'warning', 'cautious', 'headwinds', 'slowdown', 'disappointing'
]);

// Intensifiers that double the weight of the next word
const INTENSIFIERS = new Set([
  'significantly', 'sharply', 'dramatically', 'substantially', 'massively',
  'unexpectedly', 'surprisingly', 'severely', 'strongly', 'heavily'
]);

// Negations that flip sentiment
const NEGATIONS = new Set([
  'not', 'no', "n't", 'never', 'neither', 'barely', 'hardly', 'fails', 'failed'
]);

export function analyzeSentiment(text) {
  if (!text) return { score: 0, label: 'neutral', confidence: 0 };

  const lower = text.toLowerCase();
  let score = 0;
  let matchCount = 0;

  // Check phrases first (higher weight)
  BULLISH_PHRASES.forEach(phrase => {
    if (lower.includes(phrase)) { score += 2; matchCount++; }
  });
  BEARISH_PHRASES.forEach(phrase => {
    if (lower.includes(phrase)) { score -= 2; matchCount++; }
  });

  // Tokenize and check individual words
  const tokens = lower.split(/[\s,.!?;:()"']+/).filter(Boolean);
  let skipNext = false;
  let negateNext = false;
  let intensifyNext = false;

  tokens.forEach((token, i) => {
    if (skipNext) { skipNext = false; return; }

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

export function analyzeArticles(articles) {
  if (!articles || articles.length === 0) return { score: 0, label: 'neutral', articles: [] };

  const analyzed = articles.map(article => {
    const titleSentiment = analyzeSentiment(article.headline || article.title || '');
    const bodySentiment = analyzeSentiment(article.summary || article.description || '');
    // Title carries more weight
    const score = titleSentiment.score * 0.6 + bodySentiment.score * 0.4;
    return { ...article, sentiment: { score, label: score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral' } };
  });

  const avgScore = analyzed.reduce((sum, a) => sum + a.sentiment.score, 0) / analyzed.length;

  return {
    score: avgScore,
    label: avgScore > 0.15 ? 'bullish' : avgScore < -0.15 ? 'bearish' : 'neutral',
    articles: analyzed
  };
}
