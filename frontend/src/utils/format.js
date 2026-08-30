import { t } from '../i18n/index.js';
import { intlLocale, readLocale } from '../i18n/locale.js';

export function formatPrice(price, currency = 'USD') {
  if (price == null || Number.isNaN(Number(price))) return '—';
  const n = Number(price);
  const cur = currency === 'GBp' ? 'GBP' : (currency || 'USD');
  try {
    return new Intl.NumberFormat(intlLocale(), {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number(value));
}

export function formatPct(pct, digits = 2) {
  if (pct == null || Number.isNaN(Number(pct))) return '—';
  const n = Number(pct);
  const formatted = formatNumber(Math.abs(n), digits);
  if (n > 0) return `+${formatted}%`;
  if (n < 0) return `-${formatted}%`;
  return `${formatted}%`;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const iso = String(ts).includes('T') ? String(ts) : `${String(ts).replace(' ', 'T')}Z`;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(mins) || mins < 1) return t('time.justNow');
  if (mins < 60) return t('time.minutesAgo', { n: mins });
  const h = Math.floor(mins / 60);
  if (h < 24) return t('time.hoursAgo', { n: h });
  return t('time.daysAgo', { n: Math.floor(h / 24) });
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString(intlLocale(readLocale()), {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
