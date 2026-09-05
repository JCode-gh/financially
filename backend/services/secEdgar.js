import axios from 'axios';
import { createTtlCache } from '../lib/cache.js';

const { cached } = createTtlCache();
const UA = 'Financially Desk desk@localhost';
const http = axios.create({
  timeout: 12000,
  headers: { 'User-Agent': UA, Accept: 'application/json' }
});

function baseTicker(symbol) {
  return String(symbol || '').split('.')[0].toUpperCase();
}

function tickerInNames(names, symbol) {
  const base = baseTicker(symbol);
  const re = new RegExp(`\\(${base}\\)`, 'i');
  return (names || []).some(n => re.test(String(n)));
}

function cikFromHit(src, symbol) {
  const base = baseTicker(symbol);
  const names = src.display_names || [];
  const named = names.find(n => new RegExp(`\\(${base}\\)`, 'i').test(String(n)));
  const fromName = String(named || '').match(/CIK\s*0*(\d+)/i);
  if (fromName) return String(fromName[1]).padStart(10, '0');
  const cik = src.ciks?.find(Boolean);
  return cik ? String(cik).padStart(10, '0') : '';
}

function filingUrl(cik, accession, doc) {
  const n = String(cik).replace(/^0+/, '');
  const acc = String(accession || '').replace(/-/g, '');
  if (!n || !acc || !doc) return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=10`;
  return `https://www.sec.gov/Archives/edgar/data/${n}/${acc}/${doc}`;
}

async function efts(symbol, forms, days = 180) {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const q = `"${baseTicker(symbol)}"`;
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&dateRange=custom&startdt=${start}&enddt=${end}&forms=${encodeURIComponent(forms)}`;
  const res = await http.get(url);
  return (res.data?.hits?.hits || []).map(h => h._source).filter(Boolean);
}

async function submissions(cik) {
  const res = await http.get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  return res.data;
}

export async function getSecDeskData(symbol) {
  const base = baseTicker(symbol);
  if (!/^[A-Z]{1,5}$/.test(base)) return null;
  return cached(`sec_${base}`, 6 * 3600_000, async () => {
    let rows = [];
    try {
      rows = await efts(base, '10-K,10-Q,20-F,6-K,8-K,4', 200);
    } catch {
      rows = [];
    }
    const matched = rows.filter(r => tickerInNames(r.display_names, base));
    const cik = matched.length ? cikFromHit(matched[0], base) : '';
    let filings = matched
      .filter(r => r.form && r.form !== '4')
      .slice(0, 12)
      .map(r => ({
        type: r.form,
        date: r.file_date || r.period_ending || '',
        title: r.file_description || r.form,
        url: r.adsh && cik ? filingUrl(cik, r.adsh, '') : ''
      }));
    let insider = matched
      .filter(r => r.form === '4')
      .slice(0, 12)
      .map(r => ({
        name: (r.display_names || []).find(n => !new RegExp(`\\(${base}\\)`, 'i').test(n)) || r.display_names?.[0] || 'Insider',
        shares: 0,
        date: r.file_date || '',
        code: '4'
      }));

    if (cik) {
      try {
        const sub = await submissions(cik);
        const rec = sub?.filings?.recent;
        const forms = rec?.form || [];
        if (forms.length) {
          const fromSub = forms.map((form, i) => ({
            type: form,
            date: rec.filingDate?.[i] || '',
            title: rec.primaryDocDescription?.[i] || form,
            url: filingUrl(cik, rec.accessionNumber?.[i], rec.primaryDocument?.[i])
          }));
          const cutoff = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
          filings = fromSub.filter(f => /^(10-K|10-Q|20-F|6-K|8-K)/i.test(f.type) && f.date >= cutoff).slice(0, 12);
          if (!insider.length) {
            insider = fromSub
              .filter(f => f.type === '4' && f.date >= new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
              .slice(0, 12)
              .map(f => ({ name: sub.name || 'Insider', shares: 0, date: f.date, code: '4' }));
          }
        }
      } catch { /* keep EFTS rows */ }
    }

    if (!filings.length && !insider.length) return null;
    return { filings, insider };
  });
}
