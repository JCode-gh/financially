export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const message = status >= 500 && !err.status
    ? 'Internal server error'
    : (err.message || 'Request failed');
  if (status >= 500) {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  }
  res.status(status).json({
    success: false,
    error: message,
    code: err.code || (status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED')
  });
}

export function ok(res, data, extra = {}) {
  return res.json({ success: true, data, ...extra });
}
