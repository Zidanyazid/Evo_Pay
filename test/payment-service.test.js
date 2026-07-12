import test from 'node:test';
import assert from 'node:assert/strict';
import db, { hashApiKey, id, now } from '../src/database.js';
import { PaymentService } from '../src/services/payment-service.js';

const fakeProvider = {
  async createPayment(input) { return { providerReference: input.reference, providerTransactionId: 'provider-transaction', status: 'PENDING', totalAmount: input.amount, paymentCode: '0812345678', paymentUrl: null, qrString: '000201', expiresAt: null, instructions: {}, raw: {} }; },
  async getPaymentStatus() { return { status: 'PAID', providerTransactionId: 'provider-transaction', raw: { status: 'success' } }; }
};
const service = new PaymentService(fakeProvider);
const merchant = { id: id('m_test'), name: 'Test merchant' };
db.prepare('INSERT INTO merchants (id,name,api_key_hash,created_at) VALUES (?,?,?,?)').run(merchant.id, merchant.name, hashApiKey(id('key')), now());

test('deduplicates an order for the same merchant', async () => {
  const input = { order_id: id('order'), amount: 10000, payment_method: 'qris' };
  const first = await service.create(merchant, input);
  const duplicate = await service.create(merchant, input);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.payment.id, duplicate.payment.id);
});

test('does not regress a final payment state', async () => {
  const created = await service.create(merchant, { order_id: id('order'), amount: 12000, payment_method: 'qris' });
  const paid = service.updateStatus(created.payment, 'PAID');
  const attemptedRegression = service.updateStatus(paid, 'PENDING');
  assert.equal(attemptedRegression.status, 'PAID');
});

test('charges configured administrative fee to customer', async () => {
  db.prepare("UPDATE merchant_payment_methods SET admin_fee_fixed=1500,admin_fee_percentage=1,fee_bearer='CUSTOMER',minimum_amount=1000,maximum_amount=1000000 WHERE merchant_id=? AND payment_method='QRIS'").run(merchant.id);
  const created=await service.create(merchant,{order_id:id('order'),amount:10000,payment_method:'QRIS'});
  assert.equal(created.payment.fee_amount,1600);
  assert.equal(created.payment.total_amount,11600);
  assert.equal(created.payment.net_amount,10000);
  assert.equal(JSON.parse(created.payment.fee_snapshot_json).source,'PAYMENT_METHOD');
});

test('charges configured administrative fee to merchant', async () => {
  db.prepare("UPDATE merchant_payment_methods SET admin_fee_fixed=1000,admin_fee_percentage=0,fee_bearer='MERCHANT' WHERE merchant_id=? AND payment_method='QRIS'").run(merchant.id);
  const created=await service.create(merchant,{order_id:id('order'),amount:10000,payment_method:'QRIS'});
  assert.equal(created.payment.fee_amount,1000);
  assert.equal(created.payment.total_amount,10000);
  assert.equal(created.payment.net_amount,9000);
});
