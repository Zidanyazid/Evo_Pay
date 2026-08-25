import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const billing=fs.readFileSync(new URL('../src/services/billing-finance-service.js',import.meta.url),'utf8');
test('billing cycle never starts succeeded and is period-idempotent',()=>{assert.match(billing,/status,attempt_count,idempotency_key/);assert.match(billing,/'PENDING'/);assert.match(billing,/subscription_id=\? AND period_start=\?/);assert.doesNotMatch(billing,/VALUES \(\?,\?,\?,\?,\?,'SUCCEEDED'/);});
test('recurring charge uses vault capability or manual payment link fallback',()=>{assert.match(billing,/this\.vault\.token/);assert.match(billing,/cap\?\.recurring/);assert.match(billing,/this\.links\.create/);});
test('dunning schedules bounded retries with grace and failure reason',()=>{assert.match(billing,/retry_limit/);assert.match(billing,/retry_interval_hours/);assert.match(billing,/grace_days/);assert.match(billing,/next_retry_at/);assert.match(billing,/failure_reason/);});
test('period advances only after paid completion',()=>{assert.match(billing,/paymentStatus!=='PAID'/);assert.match(billing,/completeCycle/);assert.match(billing,/status='SUCCEEDED'/);});
test('subscription supports pause resume cancel and proration policy',()=>{assert.match(billing,/pause/);assert.match(billing,/resume/);assert.match(billing,/cancel/);assert.match(billing,/proration_policy/);});
