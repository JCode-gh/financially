export const LOCALE_KEY = 'financially.locale';

export function readLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'en' || stored === 'nl') return stored;
  } catch { /* ignore */ }
  return 'nl';
}

export function writeLocale(locale) {
  try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* ignore */ }
}

export function intlLocale(locale = readLocale()) {
  return locale === 'nl' ? 'nl-NL' : 'en-US';
}
