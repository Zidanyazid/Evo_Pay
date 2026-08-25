import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../src/routes/merchant-portal-routes.js',import.meta.url),'utf8');
test('project portal scopes every operational read and replay to merchant_id',()=>{
  assert.match(source,/WHERE merchant_id=\?/);
  assert.match(source,/la\.merchant_id=\?/);
  assert.match(source,/WHERE d\.id=\? AND p\.merchant_id=\?/);
  assert.match(source,/webhook\.replayed/);
});
test('project portal exposes the required Phase 1 operations endpoints',()=>{
  for(const endpoint of ['/overview','/ledger','/settlements','/deliveries/:deliveryId/replay'])assert.ok(source.includes(endpoint));
});
