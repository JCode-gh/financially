export function normalizeLang(raw) {
  return String(raw || '').toLowerCase().startsWith('nl') ? 'nl' : 'en';
}

export function requestLang(req) {
  return normalizeLang(req.body?.lang || req.query?.lang || req.get?.('accept-language') || '');
}

const NL_WORDS = /\b(de|het|een|van|voor|met|naar|dat|die|dit|aan|op|zijn|wordt|worden|blijf|blijven|koop|kopen|verkoop|verkopen|houden|houd|aandeel|aandelen|sessie|risico|omdat|volgende|niet|geen|maar|ook|als|kan|moet|deze|belegger|koers|winst|verlies|zijlijn|wacht|nu|tegen|onder|boven|sterk|zwak|gemengd|cijfers|nieuws|techniek|overtuiging)\b/gi;
const EN_WORDS = /\b(the|and|for|with|this|that|from|into|hold|buy|sell|next|session|stock|because|while|remain|trader|price|should|would|could|stand|aside|weak|mixed|tape|news|earnings|shares|outlook)\b/gi;

export function textMatchesLang(text, lang) {
  const s = String(text || '');
  if (s.trim().length < 16) return true;
  const nl = (s.match(NL_WORDS) || []).length;
  const en = (s.match(EN_WORDS) || []).length;
  if (nl + en < 3) return true;
  return lang === 'nl' ? nl >= en : en >= nl;
}
