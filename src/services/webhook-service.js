import crypto from 'node:crypto';
import db, { id, now } from '../database.js';
import { publicPayment } from './payment-service.js';
import { config } from '../config.js';
import { resolvePublicUrl, validateOutboundUrl } from './outbound-url-policy.js';
import { log } from '../observability.js';

export class WebhookService {
  constructor(provider, paymentService) { this.provider = provider; this.paymentService = paymentService; }
  async handleTokopay(payload) {
    const valid = this.provider.verifyWebhook(payload); const reference = payload.reff_id || payload.ref_id;
    const payment = reference ? await db.get('SELECT * FROM payments WHERE provider_reference=?', [reference]) : null;
    await db.run('INSERT INTO payment_events (id,payment_id,provider,event_type,signature_valid,payload_json,created_at) VALUES (?,?,?,?,?,?,?)', [id('evt'), payment?.id || null, 'tokopay', 'webhook_received', valid ? 1 : 0, JSON.stringify(payload), now()]);
    if (!valid || !payment) return { accepted: false, payment: null };
    const amount = Number(payload?.data?.total_dibayar || payload?.data?.nominal || payment.total_amount);
    if (amount !== payment.total_amount) return { accepted: false, payment: null };
    const rawStatus=payload?.data?.status||payload?.payment_status||payload?.status;
    const value=String(rawStatus||'').toLowerCase();
    const status=['success','completed','paid'].includes(value)?'PAID':['expired','expire'].includes(value)?'EXPIRED':['failed','failure','cancelled','canceled'].includes(value)?'FAILED':'PENDING';
    const synchronized=await this.paymentService.updateStatus(payment,status,{raw:payload,providerTransactionId:payload.reference});
    if(synchronized.status==='PAID')await this.queueMerchantCallback(synchronized);
    return {accepted:true,payment:synchronized};
  }
  async queueMerchantCallback(payment, eventType = 'payment.paid') {
    const merchant = await db.get('SELECT * FROM merchants WHERE id=?', [payment.merchant_id]); if (!merchant?.callback_url) return;
    const afterPaid=payment.paid_at?" AND created_at>=?":'';
    const duplicate=await db.get(`SELECT id FROM webhook_deliveries WHERE payment_id=? AND event_type=? AND status IN ('PENDING','RETRYING','DELIVERED')${afterPaid}`,[payment.id,eventType,...(payment.paid_at?[payment.paid_at]:[])]); if(duplicate)return duplicate.id;
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
      const res = await fetch(item.url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'x-evopay-event': item.event_type, 'x-evopay-signature': `sha256=${item.signature}`, 'x-evopay-delivery': item.id }, body: item.payload_json, signal: AbortSignal.timeout(config.webhookTimeoutMs) });
      const responseBody = (await res.text().catch(() => '')).slice(0, 2000); const attempt = item.attempt_count + 1;
      await this.recordAttempt(item.id, attempt, res.status, responseBody, null, Date.now() - startedAt);
      if (res.ok) { await db.run('UPDATE webhook_deliveries SET status=?,attempt_count=?,response_code=?,response_body=?,last_error=NULL,delivered_at=?,updated_at=? WHERE id=?', ['DELIVERED', attempt, res.status, responseBody, now(), now(), item.id]); log('info', 'merchant_webhook_delivered', { delivery_id: item.id, payment_id: item.payment_id, attempt, status: res.status, duration_ms: Date.now() - startedAt }); }
      else await this.scheduleRetry(item, attempt, `HTTP ${res.status}`, res.status, responseBody);
    } catch (error) { const attempt = item.attempt_count + 1; await this.recordAttempt(item.id, attempt, null, null, error.message, Date.now() - startedAt); await this.scheduleRetry(item, attempt, error.message, null, null); log('error', 'merchant_webhook_failed', { delivery_id: item.id, payment_id: item.payment_id, attempt, message: error.message, duration_ms: Date.now() - startedAt }); }
  }
  async recordAttempt(deliveryId, attempt, responseCode, responseBody, error, latencyMs) { await db.run('INSERT INTO webhook_attempts (id,delivery_id,attempt_number,response_code,response_body,error,latency_ms,created_at) VALUES (?,?,?,?,?,?,?,?)', [id('wha'), deliveryId, attempt, responseCode, responseBody, error, latencyMs, now()]); }
  async scheduleRetry(item, attempt, error, code, body) { const delay = config.webhookRetries[attempt]; const status = delay == null ? 'DEAD_LETTER' : 'RETRYING'; const next = delay == null ? null : new Date(Date.now() + delay * 1000).toISOString(); await db.run('UPDATE webhook_deliveries SET status=?,attempt_count=?,response_code=?,response_body=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?', [status, attempt, code, body, error, next, now(), item.id]); }
  async replay(deliveryId, overrideUrl = null, reason = null) {
    const original = await db.get('SELECT * FROM webhook_deliveries WHERE id=?', [deliveryId]);
    if (!original) throw Object.assign(new Error('Delivery tidak ditemukan.'), { status: 404 });
    if(!reason?.trim()||reason.trim().length>255)throw Object.assign(new Error('Alasan replay wajib diisi.'),{status:422});
    const payment = await db.get('SELECT p.*,m.webhook_secret,m.api_key_hash FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE p.id=?', [original.payment_id]);
    const timestamp = now(), newId = id('dlv'), secret = payment.webhook_secret || payment.api_key_hash;
    const signature = crypto.createHmac('sha256', secret).update(original.payload_json).digest('hex'); const target = overrideUrl ? validateOutboundUrl(overrideUrl).toString() : original.url;
    await db.run('INSERT INTO webhook_deliveries (id,payment_id,url,payload_json,status,event_type,next_attempt_at,signature,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [newId, original.payment_id, target, original.payload_json, 'PENDING', original.event_type, timestamp, signature, timestamp, timestamp]);
    await db.run('UPDATE webhook_deliveries SET replay_of=?,replay_reason=? WHERE id=?',[original.id,reason.trim(),newId]);
    void this.deliver(newId); return { queued: true, delivery_id: newId, replay_of: original.id };
  }
  async verifyEndpoint(url){const target=validateOutboundUrl(url).toString();await resolvePublicUrl(target);const started=Date.now();const response=await fetch(target,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(config.webhookTimeoutMs)});return{url:target,reachable:response.status<500,status:response.status,latency_ms:Date.now()-started};}
  async rotateSecret(merchantId,overlapHours=24){const merchant=await db.get('SELECT webhook_secret FROM merchants WHERE id=?',[merchantId]);if(!merchant)throw Object.assign(new Error('Project tidak ditemukan.'),{status:404});const secret=`whsec_${crypto.randomBytes(32).toString('base64url')}`,ends=new Date(Date.now()+Math.min(168,Math.max(1,Number(overlapHours)||24))*3600000).toISOString();await db.run('UPDATE merchants SET webhook_secret_previous=webhook_secret,webhook_secret=?,webhook_secret_overlap_ends_at=? WHERE id=?',[secret,ends,merchantId]);return{secret,overlap_ends_at:ends};}
  async preview(deliveryId){const row=await db.get('SELECT id,event_type,url,status,payload_json,signature,created_at FROM webhook_deliveries WHERE id=?',[deliveryId]);if(!row)return null;return{...row,payload:JSON.parse(row.payload_json.slice(0,65536)),payload_json:undefined,signature:`sha256=${row.signature.slice(0,8)}••••`};}
  async processDue() { const due = await db.all("SELECT id FROM webhook_deliveries WHERE status IN ('PENDING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at<=?) LIMIT 25", [now()]); await Promise.allSettled(due.map((item) => this.deliver(item.id))); return due.length; }
}
