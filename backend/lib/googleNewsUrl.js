import axios from 'axios';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';
const CONSENT = { SOCS: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg' };
const REQUEST_SHELL = [
  ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
  'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0
];

const cache = new Map();

export function isGoogleNewsArticle(url) {
  return /news\.google\.com\/(?:rss\/)?articles\//i.test(String(url || ''));
}

function articleId(url) {
  const m = String(url || '').match(/articles\/([^?/#]+)/i);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function resolveGoogleNewsUrl(url) {
  const raw = String(url || '').trim();
  if (!isGoogleNewsArticle(raw)) return '';
  const hit = cache.get(raw);
  if (hit) return hit;

  try {
    const page = await axios.get(raw, {
      timeout: 8000,
      maxRedirects: 5,
      responseType: 'text',
      headers: { 'User-Agent': UA, Cookie: `SOCS=${CONSENT.SOCS}` },
      validateStatus: s => s >= 200 && s < 400
    });
    const html = String(page.data || '');
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="(\d+)"/)?.[1];
    const id = html.match(/data-n-a-id="([^"]+)"/)?.[1] || articleId(raw);
    if (!sg || !ts || !id) return '';

    const payload = JSON.stringify(['garturlreq', REQUEST_SHELL, id, Number(ts), sg]);
    const res = await axios.post(
      BATCH_URL,
      `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', payload, null, 'generic']]]))}`,
      {
        timeout: 8000,
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Cookie: `SOCS=${CONSENT.SOCS}`
        },
        validateStatus: s => s >= 200 && s < 400
      }
    );
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    const found = text.match(/garturlres\\?",\\?"(https?:[^\\"]+)/)?.[1]
      || text.match(/"garturlres","(https?:[^"]+)"/)?.[1]
      || '';
    if (found && /^https?:\/\//i.test(found) && !/news\.google\.com/i.test(found)) {
      cache.set(raw, found);
      return found;
    }
  } catch { /* leave unresolved */ }
  return '';
}
