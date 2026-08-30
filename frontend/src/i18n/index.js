import { createI18n } from 'vue-i18n';
import { readLocale, writeLocale } from './locale.js';
import en from './en.js';
import nl from './nl.js';

export const i18n = createI18n({
  legacy: false,
  locale: readLocale(),
  fallbackLocale: 'en',
  globalInjection: true,
  messages: { en, nl }
});

export function currentLocale() {
  return i18n.global.locale.value;
}

export function t(key, params) {
  return i18n.global.t(key, params || {});
}

export function applyDocumentLocale(locale = currentLocale()) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = t('app.title');
}

export function setAppLocale(locale) {
  const next = locale === 'en' ? 'en' : 'nl';
  i18n.global.locale.value = next;
  writeLocale(next);
  applyDocumentLocale(next);
  return next;
}
