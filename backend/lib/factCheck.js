const CLAIM_RE = /\b(fed|fomc|ecb|ezb|powell|warsh|rente|rate cut|rate hike|verlaagd|verhoogd|aangekondigd|announced|cpi|inflatie|oorlog|conflict|sanctie|earnings|overname|acquisition|just announced|net )\b/i;

const FED_RE = /\b(fed|fomc|federal reserve|powell|warsh)\b/i;
const USER_CUT_RE = /\b(rate cuts?|cuts? (the )?(fed )?rate|rente.?verlaag|verlaagd(e)? de rente)\b/i;
const USER_HIKE_RE = /\b(rate hikes?|hikes? (the )?(fed )?rate|rente.?verhoog|verhoogd(e)? de rente)\b/i;
const SRC_CUT_RE = /\b(rate cut|cuts? (interest )?rates?|cut (the )?(fed )?rate|cuts rates)\b/i;
const SRC_HIKE_RE = /\b(rate hike|hikes? (interest )?rates?|hike odds|raises? (interest )?rates?)\b/i;

export function looksLikeFactualClaim(text) {
  return CLAIM_RE.test(String(text || ''));
}

export function verificationQueries(text) {
  const q = String(text || '').replace(/\s+/g, ' ').trim();
  if (!q) return [];
  const out = [];
  if (FED_RE.test(q) || USER_CUT_RE.test(q) || USER_HIKE_RE.test(q) || /\brente\b/i.test(q)) {
    out.push('Federal Reserve FOMC latest interest rate decision');
  }
  if (/\b(ecb|ezb)\b/i.test(q)) out.push('ECB latest interest rate decision');
  if (/\b(cpi|inflatie|inflation)\b/i.test(q)) out.push('latest United States CPI inflation');
  if (out.length < 2 && looksLikeFactualClaim(q)) {
    out.push(q.replace(/\b(weegt dat mee|does that (weigh|change|affect))\??/gi, '').trim().slice(0, 160));
  }
  return [...new Set(out.filter(Boolean))].slice(0, 2);
}

function hitCorpus(hits) {
  return (hits || []).map(h => `${h.title || ''} ${h.content || h.summary || ''}`).join('\n');
}

export function checkUserClaims(text, hits) {
  const q = String(text || '');
  const corpus = hitCorpus(hits);
  const checks = [];

  if (FED_RE.test(q) && (USER_CUT_RE.test(q) || USER_HIKE_RE.test(q) || /\brate cuts?\b/i.test(q) || /\baangekondigd\b/i.test(q))) {
    const srcCut = SRC_CUT_RE.test(corpus);
    const srcHike = SRC_HIKE_RE.test(corpus);
    const userCut = USER_CUT_RE.test(q) || /\brate cuts?\b/i.test(q);
    const userHike = USER_HIKE_RE.test(q);
    let status = 'unverified';
    if (userCut && srcHike && !srcCut) status = 'contradicted';
    else if (userHike && srcCut && !srcHike) status = 'contradicted';
    else if ((userCut && srcCut) || (userHike && srcHike)) status = 'confirmed';
    else if (!corpus.trim()) status = 'unverified';
    checks.push({
      topic: 'fed_rates',
      status,
      userSaid: userCut ? 'rate_cut' : userHike ? 'rate_hike' : 'fed_event'
    });
  } else if (looksLikeFactualClaim(q)) {
    checks.push({ topic: 'other', status: corpus.trim() ? 'unverified' : 'unverified' });
  }

  return checks;
}

export function worstClaimStatus(checks) {
  const order = { contradicted: 3, unverified: 2, confirmed: 1 };
  let worst = '';
  for (const c of checks || []) {
    if ((order[c.status] || 0) > (order[worst] || 0)) worst = c.status;
  }
  return worst || '';
}

export function formatFactCheckBlock(checks, lang = 'en') {
  if (lang === 'nl') {
    if (!checks?.length) {
      return 'FACTCHECK: behandel elke extra bewering van de gebruiker als onbevestigd tot SEARCH RESULTS die steunen. De gebruiker kan liegen.';
    }
    const lines = checks.map(c => {
      if (c.topic === 'fed_rates' && c.status === 'contradicted') {
        return c.userSaid === 'rate_cut'
          ? '- Claim "Fed rate cut": TEGENGESPROKEN of niet bevestigd. Hits noemen een hike/odds, geen verlaging. Herhaal de cut niet als feit.'
          : '- Claim over Fed-rente: TEGENGESPROKEN door de hits. Herhaal de gebruikersclaim niet als feit.';
      }
      if (c.topic === 'fed_rates' && c.status === 'confirmed') {
        return '- Claim over Fed-rente: een hit steunt die richting. Zeg dat voorzichtig, met de bron.';
      }
      if (c.topic === 'fed_rates') {
        return '- Claim "Fed heeft X aangekondigd": NIET BEVESTIGD in de hits. Eerste zin: onbewezen. Niet herhalen als feit.';
      }
      return '- Nieuwsclaim van de gebruiker: NIET BEVESTIGD. Niet overnemen als feit.';
    });
    return `FACTCHECK (machine, niet de gebruiker):\n${lines.join('\n')}\nAntwoord eerst met de check, daarna pas of het de desk-call kleurt.`;
  }
  if (!checks?.length) {
    return 'FACT CHECK: treat every extra user assertion as unconfirmed until SEARCH RESULTS support it. The user can lie.';
  }
  const lines = checks.map(c => {
    if (c.topic === 'fed_rates' && c.status === 'contradicted') {
      return c.userSaid === 'rate_cut'
        ? '- Claim "Fed rate cut": CONTRADICTED or unsupported. Hits talk hike/odds, not a cut. Do not repeat the cut as fact.'
        : '- Fed-rate claim: CONTRADICTED by the hits. Do not repeat the user claim as fact.';
    }
    if (c.topic === 'fed_rates' && c.status === 'confirmed') {
      return '- Fed-rate claim: a hit leans that way. Say it cautiously, with the source.';
    }
    if (c.topic === 'fed_rates') {
      return '- Claim "the Fed announced X": NOT CONFIRMED in the hits. First sentence: unverified. Do not repeat it as fact.';
    }
    return '- User news claim: NOT CONFIRMED. Do not take it as fact.';
  });
  return `FACT CHECK (machine, not the user):\n${lines.join('\n')}\nLead with the check, then whether it colors the desk call.`;
}

export function honestClaimReply(status, lang = 'en') {
  if (lang === 'nl') {
    if (status === 'contradicted') {
      return 'Je claim is niet bevestigd — de extra hits spreken die tegen. Ik neem hem niet als feit. De desk-call blijft op de tape.';
    }
    if (status === 'unverified') {
      return 'Ik kan je claim niet bevestigen in de bronnen. Ik behandel hem als onbewezen. De call blijft op de tape.';
    }
    return '';
  }
  if (status === 'contradicted') {
    return 'Your claim is not confirmed — the extra hits contradict it. I am not taking it as fact. The desk call stays on the tape.';
  }
  if (status === 'unverified') {
    return 'I cannot confirm your claim in the sources. I treat it as unverified. The call stays on the tape.';
  }
  return '';
}

export function replyTreatsClaimAsFact(reply, notes) {
  const r = String(reply || '').toLowerCase();
  if (!r) return false;
  if (/\b(niet bevestigd|klopt niet|tegenspraak|onbewezen|unverified|not confirmed|contradict|niet als feit|kan (ik )?niet bevestigen)\b/i.test(r)) {
    return false;
  }
  if (/\b(rate cuts? aangekondigd|heeft rate cuts|announced rate cuts|fed (heeft )?(de rente )?verlaagd)\b/i.test(r)) {
    return true;
  }
  const skip = /^(deze|heeft|weegt|that|this|just|does|mee|voor|naar|over)$/;
  const claimWords = String(notes || '').toLowerCase().split(/\W+/).filter(w => w.length > 3 && !skip.test(w));
  if (claimWords.length < 2) return false;
  const hits = claimWords.filter(w => r.includes(w)).length;
  return hits >= Math.min(2, claimWords.length);
}
