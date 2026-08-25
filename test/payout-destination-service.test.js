import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../src/services/payout-destination-service.js',import.meta.url),'utf8');
test('payout destinations encrypt account numbers and only return a masked value',()=>{
  assert.match(source,/encryptSecret\(number\)/);
  assert.match(source,/account_mask/);
  assert.match(source,/account_mask:row\.account_mask/);
});
test('payout destinations are tenant-scoped before settlement decryption',()=>{
  assert.match(source,/WHERE id=\? AND merchant_id=\? AND is_active=1/);
});
