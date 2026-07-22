import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import db, { hashApiKey, id, now } from '../src/database.js';
import { PAYMENT_METHODS, normalizePaymentMethod } from '../src/payment-methods.js';
import { PaymentMethodService } from '../src/services/payment-method-service.js';

const service = new PaymentMethodService();
after(()=>db.close());

const withMerchant = async (fn) => {
  const merchantId = id('m_methods');
  await db.run('INSERT INTO merchants (id,name,api_key_hash,created_at) VALUES (?,?,?,?)', [merchantId, 'Method test', hashApiKey(id('key')), now()]);
  try { return await fn(merchantId); }
  finally {
    await db.run('DELETE FROM merchant_payment_methods WHERE merchant_id=?', [merchantId]);
    await db.run('DELETE FROM merchants WHERE id=?', [merchantId]);
  }
};

test('exposes the approved 26-channel catalog', () => {
  assert.equal(PAYMENT_METHODS.length, 26);
  assert.deepEqual(Object.fromEntries(['VIRTUAL_ACCOUNT', 'E_MONEY', 'QRIS', 'RETAIL'].map((category) => [category, PAYMENT_METHODS.filter((m) => m.category === category).length])), { VIRTUAL_ACCOUNT: 10, E_MONEY: 11, QRIS: 3, RETAIL: 2 });
  assert.equal(normalizePaymentMethod('va_bca'), 'BCAVA');
  assert.equal(normalizePaymentMethod('ovo'), 'OVOPUSH');
});

test('seeds reference fees, settlement, limits, and status', async () => withMerchant(async (merchantId) => {
  const methods = await service.list(merchantId);
  const bca = methods.find((m) => m.code === 'BCAVA'), qris = methods.find((m) => m.code === 'QRIS'), dana = methods.find((m) => m.code === 'DANA');
  assert.deepEqual([bca.admin_fee_fixed, bca.settlement_label, bca.minimum_amount, bca.maximum_amount, bca.is_enabled], [4200, 'H+2', 10000, 10000000, true]);
  assert.deepEqual([qris.admin_fee_fixed, qris.admin_fee_percentage, qris.maximum_amount], [100, 0.7, 15000000]);
  assert.deepEqual([dana.admin_fee_percentage, dana.minimum_amount, dana.maximum_amount], [2.5, 10, 50000000]);
}));

test('persists merchant-specific operational overrides', async () => withMerchant(async (merchantId) => {
  const updated = await service.update(merchantId, 'VIRGO', { is_enabled: true, admin_fee_fixed: 500, admin_fee_percentage: 1, fee_bearer: 'MERCHANT', settlement_label: 'T+1', minimum_amount: 50, maximum_amount: 9000000 });
  assert.deepEqual([updated.is_enabled, updated.admin_fee_fixed, updated.admin_fee_percentage, updated.fee_bearer, updated.settlement_label, updated.minimum_amount, updated.maximum_amount], [true, 500, 1, 'MERCHANT', 'T+1', 50, 9000000]);
  await service.seedMerchant(merchantId);
  assert.equal((await service.configuration(merchantId, 'VIRGO')).admin_fee_fixed, 500);
}));

test('validates small channel minimum and payment range', async () => withMerchant(async (merchantId) => {
  assert.equal((await service.assertEnabled(merchantId, 'DANA', 10)).code, 'DANA');
  await assert.rejects(() => service.assertEnabled(merchantId, 'DANA', 9), (e) => e.code === 'PAYMENT_AMOUNT_OUT_OF_RANGE');
  await assert.rejects(() => service.assertEnabled(merchantId, 'DANA', 50000001), (e) => e.code === 'PAYMENT_AMOUNT_OUT_OF_RANGE');
}));

test('protects registration-required and invalid configurations', async () => withMerchant(async (merchantId) => {
  await assert.rejects(() => service.update(merchantId, 'QRIS_CUSTOM', { is_enabled: true }), (e) => e.code === 'PAYMENT_METHOD_REGISTRATION_REQUIRED');
  await assert.rejects(() => service.assertEnabled(merchantId, 'QRIS_CUSTOM', 100), (e) => e.code === 'PAYMENT_METHOD_REGISTRATION_REQUIRED');
  await assert.rejects(() => service.update(merchantId, 'QRIS', { minimum_amount: 10000, maximum_amount: 9000 }), (e) => e.code === 'VALIDATION_ERROR');
}));

test('rejects unknown and disabled methods with structured codes', async () => withMerchant(async (merchantId) => {
  await assert.rejects(() => service.assertEnabled(merchantId, 'UNKNOWN'), (e) => e.code === 'PAYMENT_METHOD_UNKNOWN');
  await assert.rejects(() => service.assertEnabled(merchantId, 'ASTRAPAY'), (e) => e.code === 'PAYMENT_METHOD_DISABLED');
}));
