import { t } from '../i18n/index.js';

export function usSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const get = type => parts.find(p => p.type === type)?.value;
  const weekday = get('weekday');
  let hour = Number(get('hour'));
  const minute = Number(get('minute'));
  if (hour === 24) hour = 0;

  const mins = hour * 60 + minute;
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const open = 9 * 60 + 30;
  const close = 16 * 60;

  if (weekend) return { label: t('session.weekend'), open: false };
  if (mins < 4 * 60) return { label: t('session.closed'), open: false };
  if (mins < open) return { label: t('session.preMarket'), open: false };
  if (mins < close) return { label: t('session.open'), open: true };
  if (mins < 20 * 60) return { label: t('session.afterHours'), open: false };
  return { label: t('session.closed'), open: false };
}
