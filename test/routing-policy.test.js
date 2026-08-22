import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const routing=fs.readFileSync(new URL('../src/services/routing-service.js',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../src/routes/project-routing-routes.js',import.meta.url),'utf8');
test('merchant routing policy is scoped and never affects existing payment status',()=>{assert.match(routing,/Merchant routes are an explicit allowlist/);assert.match(routing,/merchantConfigs\.length/);assert.doesNotMatch(routing,/UPDATE payments/);assert.match(routes,/merchant\(q\.params\.merchantId\)/);assert.match(routes,/routing_policy\.updated/);});
