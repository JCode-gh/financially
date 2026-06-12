const backendRoot = (import.meta.env.VITE_BACKEND_API_URL || '').replace(/\/$/, '');

/** REST API base — `/api` on the backend host, or Vite proxy in local dev when unset. */
export const API_BASE_URL = backendRoot ? `${backendRoot}/api` : '/api';

/** Live price WebSocket — `/ws` on the same backend host. */
export function getWsUrl() {
  if (backendRoot) {
    const wsRoot = backendRoot.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    return `${wsRoot}/ws`;
  }
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
