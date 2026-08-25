import crypto from 'node:crypto';
import db, { id, now } from '../database.js';
import { publicPayment } from './payment-service.js';
import { config } from '../config.js';
import { resolvePublicUrl } from './outbound-url-policy.js';
import { log, metrics } from '../observability.js';

export const responsePreview = (text = '') => String(text).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 1024);
export const retryState = (attempt) => config.webhookRetries[attempt] == null ? 'DEAD_LETTER' : 'RETRYING';

export class WebhookService {
  constructor(provider, payments) { this.provider = provider; this.payments = payments; }
  async handleTokopay(payload) {
    const reference = payload.reff_id || payload.ref_id;
    const payment = reference && await db.get('SELECT * FROM payments WHERE provider_reference=?', [reference]);
    await db.run('INSERT INTO payment_events (id,payment_id,type,payload_json,created_at) VALUES (?,?,?,?,?)', [id('evt'), payment?.id || null, 'tokopay.webhook', JSON.stringify(payload), now()]);
    if (!payment || !this.provider.verifyWebhook(payload)) return { accepted: false };
    const amount = Number(payload?.data?.total_dibayar || payload?.data?.nominal || payment.amount);
    if (amount !== Number(payment.amount)) return { accepted: false };
    const value = String(payload?.data?.status || payload?.payment_status || payload?.status || '').toLowerCase();
    const status = ['success', 'completed', 'paid'].includes(value) ? 'PAID' : ['expired', 'expire'].includes(value) ? 'EXPIRED' : ['failed', 'failure', 'cancelled'].includes(value) ? 'FAILED' : 'PENDING';
    const updated = await this.payments.updateStatus(payment, status, { raw: payload, providerTransactionId: payload.reference });
    if (updated.status === 'PAID') await this.queue(updated);
    return { accepted: true, payment: updated };
  }
  async queue(payment) {
    const site = await db.get('SELECT * FROM sites WHERE id=?', [payment.site_id]);
    if (!site?.callback_url) return;
    const existing = await db.get('SELECT id FROM callback_deliveries WHERE payment_id=?', [payment.id]);
    if (existing) return existing.id;
    const payload = JSON.stringify({ event: 'payment.paid', data: publicPayment(payment) });
    const delivery = { id: id('cb'), signature: crypto.createHmac('sha256', site.webhook_secret).update(payload).digest('hex') };
    await db.run("INSERT INTO callback_deliveries (id,payment_id,url,payload_json,signature,status,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,'PENDING',?,?,?)", [delivery.id, payment.id, site.callback_url, payload, delivery.signature, now(), now(), now()]);
    return delivery.id;
  }
  async lease(deliveryId) {
    const leaseExpired = new Date(Date.now() - config.webhookTimeoutMs * 2).toISOString();
    const claimed = await db.run("UPDATE callback_deliveries SET locked_at=?,updated_at=? WHERE id=? AND status IN ('PENDING','RETRYING') AND (locked_at IS NULL OR locked_at<?)", [now(), now(), deliveryId, leaseExpired]);
    return claimed.changes ? db.get('SELECT * FROM callback_deliveries WHERE id=?', [deliveryId]) : null;
  }
  async recordAttempt(row, attempt, fields) { await db.run('INSERT INTO callback_attempts (id,delivery_id,attempt,response_code,error,response_preview,latency_ms,created_at) VALUES (?,?,?,?,?,?,?,?)', [id('cba'), row.id, attempt, fields.status || null, fields.error || null, responsePreview(fields.preview), fields.latency, now()]); }
  async deliver(deliveryId) {
    const row = await this.lease(deliveryId); if (!row) return false;
    const started = Date.now(), attempt = row.attempt_count + 1;
    try {
      await resolvePublicUrl(row.url);
      const response = await fetch(row.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-evopay-signature': `sha256=${row.signature}`, 'x-evopay-delivery': row.id }, body: row.payload_json, signal: AbortSignal.timeout(config.webhookTimeoutMs) });
      const preview = await response.text().catch(() => '');
      await this.recordAttempt(row, attempt, { status: response.status, preview, latency: Date.now() - started });
      if (response.ok) { metrics.increment('evopay_callback_delivery_total',{outcome:'delivered'}); log('info','callback_delivered',{delivery_id:row.id,attempt,status:response.status,latency_ms:Date.now()-started}); await db.run("UPDATE callback_deliveries SET status='DELIVERED',attempt_count=?,response_code=?,last_error=NULL,next_attempt_at=NULL,locked_at=NULL,delivered_at=?,updated_at=? WHERE id=?", [attempt, response.status, now(), now(), row.id]); }
      else await this.retry(row, attempt, `HTTP ${response.status}`, response.status);
    } catch (error) {
      await this.recordAttempt(row, attempt, { error: error.message, latency: Date.now() - started });
      await this.retry(row, attempt, error.message, null);
    }
    return true;
  }
  async retry(row, attempt, error, responseCode) {
    const state = retryState(attempt), seconds = config.webhookRetries[attempt];
    metrics.increment('evopay_callback_delivery_total',{outcome:state.toLowerCase()}); log(state === 'DEAD_LETTER' ? 'error' : 'warn','callback_delivery_retry',{delivery_id:row.id,attempt,state,response_code:responseCode}); await db.run('UPDATE callback_deliveries SET status=?,attempt_count=?,response_code=?,last_error=?,next_attempt_at=?,locked_at=NULL,updated_at=? WHERE id=?', [state, attempt, responseCode, error, state === 'DEAD_LETTER' ? null : new Date(Date.now() + seconds * 1000).toISOString(), now(), row.id]);
  }
  async replay(deliveryId) {
    const result = await db.run("UPDATE callback_deliveries SET status='PENDING',next_attempt_at=?,locked_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='DEAD_LETTER'", [now(), now(), deliveryId]);
    if (!result.changes) return false;
    await this.deliver(deliveryId);
    return true;
  }
  async processDue() { const rows = await db.all("SELECT id FROM callback_deliveries WHERE status IN ('PENDING','RETRYING') AND next_attempt_at<=? AND (locked_at IS NULL OR locked_at<?) LIMIT 25", [now(), new Date(Date.now() - config.webhookTimeoutMs * 2).toISOString()]); await Promise.all(rows.map((row) => this.deliver(row.id))); return rows.length; }
}
