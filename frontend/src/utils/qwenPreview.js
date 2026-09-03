function unescapeJsonString(s) {
  return String(s || '')
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldFromPartialJson(raw, key) {
  const text = String(raw || '');
  const complete = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (complete?.[1]) return unescapeJsonString(complete[1]);
  const partial = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)$`));
  if (partial?.[1]?.length > 2) return unescapeJsonString(partial[1]);
  return '';
}

export function previewFromQwenStream(raw) {
  for (const key of ['thesis', 'doNow', 'why']) {
    const value = fieldFromPartialJson(raw, key);
    if (value) return value;
  }
  const action = fieldFromPartialJson(raw, 'action');
  if (action) return action;
  return String(raw || '')
    .replace(/[{}\[\]":]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-140);
}
