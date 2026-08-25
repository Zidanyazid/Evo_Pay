import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TokopayProvider } from '../src/providers/tokopay-provider.js';

const provider = new TokopayProvider({ merchantId: 'merchant-1', secret: 'top-secret' });

test('creates Tokopay MD5 signature using merchant ID, secret, and reference', () => {
  const reference = 'NPREF001';
  const expected = crypto.createHash('md5').update('merchant-1:top-secret:NPREF001').digest('hex');
  assert.equal(provider.signature(reference), expected);
});

test('accepts valid webhook signature and rejects invalid signatures', () => {
  const reff_id = 'NPREF001';
  assert.equal(provider.verifyWebhook({ reff_id, signature: provider.signature(reff_id) }), true);
  assert.equal(provider.verifyWebhook({ reff_id, signature: 'invalid-signature' }), false);
});

test('publishes the approved Tokopay payment method capabilities', () => {
  const capabilities=provider.capabilities();
  assert.equal(capabilities.length,26);
  assert.ok(capabilities.includes('BRIVA'));
  assert.ok(capabilities.includes('QRISREALTIME'));
  assert.ok(capabilities.includes('QRIS_CUSTOM'));
});

test('does not treat successful order creation as a paid payment', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    status: true,
    data: { status: 'Success', reff_id: 'NPREF001', reference: 'TP001', nominal: 1000 }
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const result = await provider.createPayment({ reference: 'NPREF001', amount: 1000, paymentMethod: 'QRISREALTIME' });
  assert.equal(result.status, 'PENDING');
});
