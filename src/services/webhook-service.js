import crypto from 'node:crypto';
import db, { id, now } from '../database.js';
import { publicPayment } from './payment-service.js';
import { config } from '../config.js';
import { resolvePublicUrl, validateOutboundUrl } from './outbound-url-policy.js';

export class WebhookService {
  constructor(provider, paymentService) { this.provider = provider; this.paymentService = paymentService; }
  async handleTokopay(payload) {
    const valid = this.provider.verifyWebhook(payload); const reference = payload.reff_id || payload.ref_id;
    const payment = reference ? await db.get('SELECT * FROM payments WHERE provider_reference=?', [reference]) : null;
    await db.run('INSERT INTO payment_events (id,payment_id,provider,event_type,signature_valid,payload_json,created_at) VALUES (?,?,?,?,?,?,?)', [id('evt'), payment?.id || null, 'tokopay', 'webhook_received', valid ? 1 : 0, JSON.stringify(payload), now()]);
    if (!valid || !payment) return { accepted: false, payment: null };
    const amount = Number(payload?.data?.total_dibayar || payload?.data?.nominal || payment.total_amount);
    if (amount !== payment.total_amount) return { accepted: false, payment: null };
    const synchronized = await this.paymentService.sync(payment).catch(async () => this.paymentService.updateStatus(payment, ['success', 'completed'].includes(String(payload.status).toLowerCase()) ? 'PAID' : 'PENDING', { raw: payload, providerTransactionId: payload.reference }));
    if (synchronized.status === 'PAID') await this.queueMerchantCallback(synchronized);
    return { accepted: true, payment: synchronized };
  }
  async queueMerchantCallback(payment, eventType = 'payment.paid') {
    const merchant = await db.get('SELECT * FROM merchants WHERE id=?', [payment.merchant_id]); if (!merchant?.callback_url) return;
    const duplicate = await db.get("SELECT id FROM webhook_deliveries WHERE payment_id=? AND event_type=? AND status IN ('PENDING','RETRYING','DELIVERED')", [payment.id, eventType]); if (duplicate) return duplicate.id;
    const timestamp = now(); const deliveryId = id('dlv'); const body = JSON.stringify({ event: eventType, data: publicPayment(payment) });
    const secret = merchant.webhook_secret || merchant.api_key_hash; const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    await db.run('INSERT INTO webhook_deliveries (id,payment_id,url,payload_json,status,event_type,next_attempt_at,signature,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [deliveryId, payment.id, merchant.callback_url, body, 'PENDING', eventType, timestamp, signature, timestamp, timestamp]);
    void this.deliver(deliveryId); return deliveryId;
  }
  async deliver(deliveryId) {
    const item = await db.get('SELECT * FROM webhook_deliveries WHERE id=?', [deliveryId]); if (!item || item.status === 'DELIVERED') return;
    const startedAt = Date.now();
    try {
      await resolvePublicUrl(item.url);
      const res = await fetch(item.url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'x-nexuspay-event': item.event_type, 'x-nexuspay-signature': `sha256=${item.signature}`, 'x-nexuspay-delivery': item.id }, body: item.payload_json, signal: AbortSignal.timeout(config.webhookTimeoutMs) });
      const responseBody = (await res.text().catch(() => '')).slice(0, 2000); const attempt = item.attempt_count + 1;
      await this.recordAttempt(item.id, attempt, res.status, responseBody, null, Date.now() - startedAt);
      if (res.ok) await db.run('UPDATE webhook_deliveries SET status=?,attempt_count=?,response_code=?,response_body=?,last_error=NULL,delivered_at=?,updated_at=? WHERE id=?', ['DELIVERED', attempt, res.status, responseBody, now(), now(), item.id]);
      else await this.scheduleRetry(item, attempt, `HTTP ${res.status}`, res.status, responseBody);
    } catch (error) { const attempt = item.attempt_count + 1; await this.recordAttempt(item.id, attempt, null, null, error.message, Date.now() - startedAt); await this.scheduleRetry(item, attempt, error.message, null, null); }
  }
  async recordAttempt(deliveryId, attempt, responseCode, responseBody, error, latencyMs) { await db.run('INSERT INTO webhook_attempts (id,delivery_id,attempt_number,response_code,response_body,error,latency_ms,created_at) VALUES (?,?,?,?,?,?,?,?)', [id('wha'), deliveryId, attempt, responseCode, responseBody, error, latencyMs, now()]); }
  async scheduleRetry(item, attempt, error, code, body) { const delay = config.webhookRetries[attempt]; const status = delay == null ? 'DEAD_LETTER' : 'RETRYING'; const next = delay == null ? null : new Date(Date.now() + delay * 1000).toISOString(); await db.run('UPDATE webhook_deliveries SET status=?,attempt_count=?,response_code=?,response_body=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?', [status, attempt, code, body, error, next, now(), item.id]); }
  async replay(deliveryId, overrideUrl = null) {
    const original = await db.get('SELECT * FROM webhook_deliveries WHERE id=?', [deliveryId]);
    if (!original) throw Object.assign(new Error('Delivery tidak ditemukan.'), { status: 404 });
    const payment = await db.get('SELECT p.*,m.webhook_secret,m.api_key_hash FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE p.id=?', [original.payment_id]);
    const timestamp = now(), newId = id('dlv'), secret = payment.webhook_secret || payment.api_key_hash;
    const signature = crypto.createHmac('sha256', secret).update(original.payload_json).digest('hex'); const target = overrideUrl ? validateOutboundUrl(overrideUrl).toString() : original.url;
    await db.run('INSERT INTO webhook_deliveries (id,payment_id,url,payload_json,status,event_type,next_attempt_at,signature,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [newId, original.payment_id, target, original.payload_json, 'PENDING', original.event_type, timestamp, signature, timestamp, timestamp]);
    void this.deliver(newId); return { queued: true, delivery_id: newId, replay_of: original.id };
  }
  async processDue() { const due = await db.all("SELECT id FROM webhook_deliveries WHERE status IN ('PENDING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at<=?) LIMIT 25", [now()]); await Promise.allSettled(due.map((item) => this.deliver(item.id))); return due.length; }
}
