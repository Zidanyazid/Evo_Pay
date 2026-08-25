import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('server honors TRUST_PROXY before IP filtered webhooks', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(source, /app\.set\('trust proxy'/);
  assert.match(source, /process\.env\.TRUST_PROXY/);
  assert.ok(source.indexOf("app.set('trust proxy'") < source.indexOf('app.use(requestCorrelation)'));
});
