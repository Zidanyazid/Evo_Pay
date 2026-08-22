import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../src/routes/project-cases-routes.js',import.meta.url),'utf8');
test('case routes scope disputes and notices to merchant payments',()=>{
 assert.match(source,/WHERE d\.id=\? AND p\.merchant_id=\?/);
 assert.match(source,/WHERE p\.merchant_id=\?/);
 assert.match(source,/WHERE id=\? AND merchant_id=\? AND status='PAID'/);
});
test('case route workflow writes audit records',()=>{
 for(const action of ['dispute.created','dispute.transitioned','dispute.evidence_added'])assert.ok(source.includes(action));
});
