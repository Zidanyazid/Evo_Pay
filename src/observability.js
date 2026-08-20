const secretKey = /(?:authorization|api[_-]?key|secret|signature|token|password|cookie)/i;
export const sanitize = (value, key = '') => {
  if (secretKey.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  return value;
};
export const log = (level, event, fields = {}) => console[level === 'error' || level === 'fatal' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(sanitize({ timestamp: new Date().toISOString(), level, event, ...fields })));

const counters = new Map(), durations = new Map();
const labels = (values) => Object.entries(values).map(([k, v]) => `${k}="${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',');
export const metrics = {
  observeRequest(method, route, status, durationMs) {
    const requestKey = labels({ method, route, status }); counters.set(requestKey, (counters.get(requestKey) || 0) + 1);
    const durationKey = labels({ method, route }); const current = durations.get(durationKey) || { count: 0, sum: 0 }; current.count++; current.sum += durationMs; durations.set(durationKey, current);
  },
  render() {
    const lines = ['# TYPE evopay_http_requests_total counter'];
    for (const [key, value] of counters) lines.push(`evopay_http_requests_total{${key}} ${value}`);
    lines.push('# TYPE evopay_http_request_duration_ms summary');
    for (const [key, value] of durations) lines.push(`evopay_http_request_duration_ms_count{${key}} ${value.count}`, `evopay_http_request_duration_ms_sum{${key}} ${value.sum}`);
    return `${lines.join('\n')}\n`;
  },
  reset() { counters.clear(); durations.clear(); }
};

export const requestObserver = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path.replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, '/:id');
    metrics.observeRequest(req.method, route, res.statusCode, durationMs);
    log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http_request', { request_id: req.id, method: req.method, route, status: res.statusCode, duration_ms: durationMs, ip: req.ip });
  });
  next();
};
