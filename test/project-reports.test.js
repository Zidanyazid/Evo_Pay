import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const routes=fs.readFileSync(new URL('../src/routes/project-reports-routes.js',import.meta.url),'utf8');
const service=fs.readFileSync(new URL('../src/services/finance-service.js',import.meta.url),'utf8');
test('project reports are merchant-scoped and export CSV with audit logging',()=>{assert.match(routes,/merchant\(q\.params\.merchantId\)/);assert.match(routes,/report\.exported/);assert.match(routes,/attachment\(/);assert.match(service,/async report\(merchantId/);assert.match(service,/async reconcile\(merchantId/);});
