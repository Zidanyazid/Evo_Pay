import crypto from 'node:crypto';
import db, { id, now } from '../database.js';
import { calculateFee } from './fee-service.js';
import { config } from '../config.js';
import { PaymentMethodService } from './payment-method-service.js';

const finalStatuses = new Set(['PAID', 'FAILED', 'EXPIRED']);
export const publicPayment = (row) => ({
  id: row.id, merchant_id: row.merchant_id, order_id: row.merchant_order_id, provider: row.provider,
  reference: row.provider_reference, provider_transaction_id: row.provider_transaction_id,
  status: row.status, payment_method: row.payment_method, amount: row.amount, total_amount: row.total_amount,
  fee_amount: row.fee_amount || 0, net_amount: row.net_amount ?? row.amount,
  customer: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone },
  checkout_url: row.checkout_token ? `${config.baseUrl}/pay/${row.checkout_token}` : null,
  redirect_url: row.redirect_url, payment_code: row.payment_code, payment_url: row.payment_url, qr_string: row.qr_string,
  instructions: row.instructions_json ? JSON.parse(row.instructions_json) : null, expires_at: row.expires_at,
  paid_at: row.paid_at, description: row.description, created_at: row.created_at, updated_at: row.updated_at
});

export class PaymentService {
  constructor(providerOrRouting, financeService = null) {
    this.routing = providerOrRouting?.select ? providerOrRouting : null;
    this.provider = this.routing ? null : providerOrRouting;
    this.finance = financeService;
    this.paymentMethods = new PaymentMethodService();
  }

  providerFor(payment) { return this.routing ? this.routing.registry.get(payment.provider) : this.provider; }
  async findForMerchant(merchantId, paymentId) { return db.get('SELECT * FROM payments WHERE id=? AND merchant_id=?', [paymentId, merchantId]); }
  async findCheckout(token) { return db.get('SELECT p.*,m.name merchant_name,m.brand_json FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE p.checkout_token=?', [token]); }

  async create(merchant, input) {
    const methodConfig = await this.paymentMethods.assertEnabled(merchant.id, input.payment_method, input.amount);
    const paymentMethod = methodConfig.code;
    input = { ...input, payment_method: paymentMethod };
    const existing = await db.get('SELECT * FROM payments WHERE merchant_id=? AND merchant_order_id=?', [merchant.id, input.order_id]);
    if (existing) return { payment: existing, duplicate: true };

    const risk = this.risk ? await this.risk.evaluate(merchant, input) : null;
    if (risk?.decision === 'BLOCK') throw Object.assign(new Error('Pembayaran ditolak oleh risk engine.'), { status: 403, code: 'RISK_BLOCKED', risk_event_id: risk.id });
    if (risk?.decision === 'REVIEW') throw Object.assign(new Error('Pembayaran memerlukan manual review.'), { status: 409, code: 'RISK_REVIEW_REQUIRED', risk_event_id: risk.id });

    const selected = this.routing ? await this.routing.select(merchant.id, input.payment_method, input.amount) : { name: 'tokopay', provider: this.provider };
    const fee = await calculateFee({ merchantId: merchant.id, provider: selected.name, method: input.payment_method, amount: input.amount, methodConfig });
    fee.settlement = methodConfig.settlement_label;
    fee.minimumAmount = methodConfig.minimum_amount;
    fee.maximumAmount = methodConfig.maximum_amount;
    const total = input.amount + fee.customerFee;
    const net = input.amount - fee.merchantFee;
    const paymentId = id('pay');
    const attemptId = id('att');
    const reference = `NP${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const checkoutToken = crypto.randomBytes(24).toString('base64url');
    const timestamp = now();

    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO payments (id,merchant_id,merchant_order_id,provider,provider_reference,payment_method,amount,total_amount,status,customer_name,customer_email,customer_phone,description,checkout_token,redirect_url,fee_amount,net_amount,fee_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [paymentId, merchant.id, input.order_id, selected.name, reference, input.payment_method, input.amount, total, 'PENDING', input.customer?.name || null, input.customer?.email || null, input.customer?.phone || null, input.description || null, checkoutToken, input.redirect_url || null, fee.fee, net, JSON.stringify(fee), timestamp, timestamp]);
      await tx.run('INSERT INTO payment_attempts (id,payment_id,provider,status,created_at,updated_at) VALUES (?,?,?,?,?,?)', [attemptId, paymentId, selected.name, 'CREATING', timestamp, timestamp]);
    });

    try {
      const result = await selected.provider.createPayment({ reference, amount: input.amount, paymentMethod: input.payment_method, customerName: input.customer?.name, customerEmail: input.customer?.email, customerPhone: input.customer?.phone, callbackUrl: `${config.baseUrl}/webhooks/${selected.name}`, redirectUrl: `${config.baseUrl}/pay/${checkoutToken}` });
      await db.transaction(async (tx) => {
        const providerTotal=Number(result.totalAmount)||0;
        const effectiveTotal=providerTotal>Number(input.amount)?providerTotal:total;
        const effectiveFee=Math.max(Number(fee.fee)||0,effectiveTotal-Number(input.amount));
        await tx.run('UPDATE payments SET provider_reference=?,provider_transaction_id=?,total_amount=?,fee_amount=?,net_amount=?,status=?,payment_code=?,payment_url=?,qr_string=?,instructions_json=?,expires_at=?,provider_payload_json=?,updated_at=? WHERE id=?', [result.providerReference, result.providerTransactionId, effectiveTotal, effectiveFee, net, 'PENDING', result.paymentCode, result.paymentUrl, result.qrString, JSON.stringify(result.instructions), result.expiresAt, JSON.stringify(result.raw), now(), paymentId]);
        await tx.run('UPDATE payment_attempts SET status=?,updated_at=? WHERE id=?', ['CREATED', now(), attemptId]);
      });
    } catch (error) {
      await db.transaction(async (tx) => {
        await tx.run('UPDATE payments SET status=?,updated_at=? WHERE id=?', ['FAILED', now(), paymentId]);
        await tx.run('UPDATE payment_attempts SET status=?,error=?,updated_at=? WHERE id=?', ['FAILED', error.message, now(), attemptId]);
      });
      throw error;
    }
    return { payment: await db.get('SELECT * FROM payments WHERE id=?', [paymentId]), duplicate: false };
  }

  async updateStatus(payment, status, details = {}) {
    if (finalStatuses.has(payment.status) && payment.status !== status) return payment;
    const paidAt = status === 'PAID' ? now() : payment.paid_at;
    await db.run('UPDATE payments SET status=?,provider_transaction_id=COALESCE(?,provider_transaction_id),paid_at=?,provider_payload_json=COALESCE(?,provider_payload_json),updated_at=? WHERE id=?', [status, details.providerTransactionId || null, paidAt, details.raw ? JSON.stringify(details.raw) : null, now(), payment.id]);
    const updated = await db.get('SELECT * FROM payments WHERE id=?', [payment.id]);
    if (updated.status === 'PAID') await this.finance?.capturePayment(updated);
    return updated;
  }

  async sync(payment) {
    const details = await this.providerFor(payment).getPaymentStatus(payment.provider_reference);
    return this.updateStatus(payment, details.status, details);
  }
}
