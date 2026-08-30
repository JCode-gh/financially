function stamp() {
  return new Date().toISOString();
}

function line(level, msg, extra) {
  if (extra !== undefined) {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      `[${stamp()}] [${level.toUpperCase()}] ${msg}`,
      extra
    );
    return;
  }
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[${stamp()}] [${level.toUpperCase()}] ${msg}`
  );
}

export const logger = {
  info: (msg, extra) => line('info', msg, extra),
  warn: (msg, extra) => line('warn', msg, extra),
  error: (msg, extra) => line('error', msg, extra)
};
