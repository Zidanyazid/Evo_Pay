import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, metrics } from '../src/observability.js';

test('structured logs redact payment secrets recursively', () => {
  assert.deepEqual(sanitize({ api_key: 'secret', nested: { signature: 'sig', status: 'PAID' } }), {
    api_key: '[REDACTED]', nested: { signature: '[REDACTED]', status: 'PAID' }
  });
});

test('metrics expose request totals and latency without high-cardinality paths', () => {
  metrics.reset();
  metrics.observeRequest('GET', '/pay/:token', 200, 12);
  metrics.observeRequest('GET', '/pay/:token', 200, 8);
  const body = metrics.render();
  assert.match(body, /evopay_http_requests_total\{method="GET",route="\/pay\/:token",status="200"\} 2/);
  assert.match(body, /evopay_http_request_duration_ms_sum\{method="GET",route="\/pay\/:token"\} 20/);
});
