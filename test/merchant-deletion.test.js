import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import db, { hashApiKey, id, now } from '../src/database.js';
import { PaymentMethodService } from '../src/services/payment-method-service.js';
import { deleteMerchant } from '../src/services/merchant-deletion-service.js';
after(()=>db.close());

const methods = new PaymentMethodService();
const createMerchant = async (name) => {
  const merchantId = id('m_delete');
  await db.run('INSERT INTO merchants (id,name,api_key_hash,created_at) VALUES (?,?,?,?)', [merchantId, name, hashApiKey(id('key')), now()]);
  await methods.seedMerchant(merchantId);
  return merchantId;
};
const removeMerchant = async (merchantId) => {
  await db.run('DELETE FROM audit_logs WHERE target_id=?', [merchantId]);
  await db.run('DELETE FROM merchant_payment_methods WHERE merchant_id=?', [merchantId]);
  await db.run('DELETE FROM merchants WHERE id=?', [merchantId]);
};

test('deletes empty merchant, dependent configuration, and records audit', async () => {
  const merchantId = await createMerchant('Delete Empty');
  try {
    const result = await deleteMerchant({ merchantId, confirmationName: 'Delete Empty', actorId: null });
    assert.equal(result.deleted, true);
    assert.equal(await db.get('SELECT 1 FROM merchants WHERE id=?', [merchantId]), undefined);
    assert.equal(Number((await db.get('SELECT COUNT(*) count FROM merchant_payment_methods WHERE merchant_id=?', [merchantId])).count), 0);
    const audit = await db.get("SELECT * FROM audit_logs WHERE action='MERCHANT_DELETED' AND target_id=?", [merchantId]);
    assert.ok(audit);
    assert.equal(JSON.parse(audit.metadata_json).name, 'Delete Empty');
  } finally { await db.run('DELETE FROM audit_logs WHERE target_id=?', [merchantId]); }
});

test('rejects mismatched confirmation without modifying merchant', async () => {
  const merchantId = await createMerchant('Exact Name');
  try {
    await assert.rejects(() => deleteMerchant({ merchantId, confirmationName: 'exact name' }), (error) => error.code === 'MERCHANT_CONFIRMATION_MISMATCH' && error.status === 422);
    assert.ok(await db.get('SELECT 1 FROM merchants WHERE id=?', [merchantId]));
  } finally { await removeMerchant(merchantId); }
});

test('rejects deletion when merchant has payment history', async () => {
  const merchantId = await createMerchant('Has History');
  const timestamp = now();
  try {
    await db.run('INSERT INTO payments (id,merchant_id,merchant_order_id,provider,payment_method,amount,total_amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id('pay'), merchantId, id('order'), 'tokopay', 'QRIS', 1000, 1000, 'PENDING', timestamp, timestamp]);
    await assert.rejects(() => deleteMerchant({ merchantId, confirmationName: 'Has History' }), (error) => error.code === 'MERCHANT_HAS_HISTORY' && error.status === 409);
    assert.ok(await db.get('SELECT 1 FROM merchants WHERE id=?', [merchantId]));
  } finally {
    await db.run('DELETE FROM payments WHERE merchant_id=?', [merchantId]);
    await removeMerchant(merchantId);
  }
});

test('returns structured not found error', async () => {
  await assert.rejects(() => deleteMerchant({ merchantId: id('missing'), confirmationName: 'Missing' }), (error) => error.code === 'MERCHANT_NOT_FOUND' && error.status === 404);
});

