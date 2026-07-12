import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.js';
import { PAYMENT_METHODS, paymentMethodByCode } from '../payment-methods.js';

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');
const normalizeStatus = (status = '') => {
  const value = String(status).toLowerCase();
  if (['success', 'completed', 'paid'].includes(value)) return 'PAID';
  if (['expired', 'expire'].includes(value)) return 'EXPIRED';
  if (['failed', 'failure', 'cancelled', 'canceled'].includes(value)) return 'FAILED';
  return 'PENDING';
};

export class TokopayProvider extends PaymentProvider {
  constructor(config = {}) {
    super();
    this.merchantId = config.merchantId || process.env.TOKOPAY_MERCHANT_ID;
    this.secret = config.secret || process.env.TOKOPAY_SECRET;
    this.baseUrl = config.baseUrl || process.env.TOKOPAY_API_URL || 'https://api.tokopay.id/v1';
  }

  signature(refId) { return md5(`${this.merchantId}:${this.secret}:${refId}`); }
  configured() { return Boolean(this.merchantId && this.secret); }
  capabilities() { return PAYMENT_METHODS.map((item)=>item.code); }

  async createPayment(input) {
    if (!paymentMethodByCode(input.paymentMethod)) throw Object.assign(new Error('Channel tidak didukung Tokopay.'),{code:'PAYMENT_METHOD_UNKNOWN',status:422});
    if (!this.configured()) throw new Error('Tokopay belum dikonfigurasi. Isi TOKOPAY_MERCHANT_ID dan TOKOPAY_SECRET.');
    const body = {
      merchant_id: this.merchantId, reff_id: input.reference, nominal: input.amount,
      metode: input.paymentMethod, customer_name: input.customerName || 'Customer',
      customer_email: input.customerEmail || '', customer_phone: input.customerPhone || '',
      signature: this.signature(input.reference), callback_url: input.callbackUrl,
      redirect_url: input.redirectUrl || undefined
    };
    const response = await fetch(`${this.baseUrl}/order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === false) throw new Error(payload.message || 'Tokopay menolak pembuatan transaksi.');
    const data = payload.data || payload;
    return {
      providerReference: data.reff_id || data.ref_id || input.reference,
      providerTransactionId: data.reference || data.trx_id || data.id || null,
      status: normalizeStatus(data.status || payload.status), totalAmount: Number(data.total_bayar || data.total_dibayar || data.nominal || input.amount),
      paymentCode: data.pay_code || data.payment_code || data.va_number || null,
      paymentUrl: data.checkout_url || data.payment_url || data.url || null,
      qrString: data.qr_string || data.qris_string || data.qr_code || null,
      expiresAt: data.expired_at || data.expiry_date || null, instructions: data.instructions || data,
      raw: payload
    };
  }

  async getPaymentStatus(reference) {
    if (!this.configured()) throw new Error('Tokopay belum dikonfigurasi.');
    const signature = this.signature(reference);
    const response = await fetch(`${this.baseUrl}/order?merchant_id=${encodeURIComponent(this.merchantId)}&reff_id=${encodeURIComponent(reference)}&signature=${signature}`, { signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Gagal menyinkronkan status Tokopay.');
    const data = payload.data || payload;
    return { status: normalizeStatus(data.status || payload.status), providerTransactionId: data.reference || data.trx_id || null, raw: payload };
  }

  verifyWebhook(payload) {
    const reference = payload.reff_id || payload.ref_id;
    if (!reference || !payload.signature || !this.configured()) return false;
    const expected = Buffer.from(this.signature(reference));
    const received = Buffer.from(String(payload.signature));
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }
}
