import crypto from 'node:crypto';
import db, { id, now } from '../database.js';
import { publicPayment } from './payment-service.js';
import { config } from '../config.js';
import { resolvePublicUrl, validateOutboundUrl } from './outbound-url-policy.js';

export class WebhookService {
  constructor(provider, paymentService) { this.provider = provider; this.paymentService = paymentService; }
  async handleTokopay(payload) {
    const valid = this.provider.verifyWebhook(payload); const reference = payload.reff_id || payload.ref_id;
    const payment = reference ? db.prepare('SELECT * FROM payments WHERE provider_reference=?').get(reference) : null;
    db.prepare('INSERT INTO payment_events (id,payment_id,provider,event_type,signature_valid,payload_json,created_at) VALUES (?,?,?,?,?,?,?)').run(id('evt'),payment?.id || null,'tokopay','webhook_received',valid ? 1 : 0,JSON.stringify(payload),now());
    if (!valid || !payment) return { accepted: false, payment: null };
    const amount = Number(payload?.data?.total_dibayar || payload?.data?.nominal || payment.total_amount);
    if (amount !== payment.total_amount) return { accepted: false, payment: null };
    const synchronized = await this.paymentService.sync(payment).catch(() => this.paymentService.updateStatus(payment,['success','completed'].includes(String(payload.status).toLowerCase()) ? 'PAID' : 'PENDING',{ raw: payload, providerTransactionId: payload.reference }));
    if (synchronized.status === 'PAID') this.queueMerchantCallback(synchronized);
    return { accepted: true, payment: synchronized };
  }
  queueMerchantCallback(payment, eventType = 'payment.paid') {
    const merchant = db.prepare('SELECT * FROM merchants WHERE id=?').get(payment.merchant_id); if (!merchant?.callback_url) return;
    const duplicate = db.prepare("SELECT id FROM webhook_deliveries WHERE payment_id=? AND event_type=? AND status IN ('PENDING','RETRYING','DELIVERED')").get(payment.id,eventType); if (duplicate) return duplicate.id;
    const timestamp = now(); const deliveryId = id('dlv'); const body = JSON.stringify({ event: eventType, data: publicPayment(payment) });
    const secret = merchant.webhook_secret || merchant.api_key_hash; const signature = crypto.createHmac('sha256',secret).update(body).digest('hex');
    db.prepare('INSERT INTO webhook_deliveries (id,payment_id,url,payload_json,status,event_type,next_attempt_at,signature,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(deliveryId,payment.id,merchant.callback_url,body,'PENDING',eventType,timestamp,signature,timestamp,timestamp);
    void this.deliver(deliveryId); return deliveryId;
  }
  async deliver(deliveryId) {
    const item = db.prepare('SELECT * FROM webhook_deliveries WHERE id=?').get(deliveryId); if (!item || item.status === 'DELIVERED') return;
    const startedAt = Date.now();
    try {
      await resolvePublicUrl(item.url);
      const res = await fetch(item.url,{ method:'POST',redirect:'manual',headers:{'content-type':'application/json','x-nexuspay-event':item.event_type,'x-nexuspay-signature':`sha256=${item.signature}`,'x-nexuspay-delivery':item.id},body:item.payload_json,signal:AbortSignal.timeout(config.webhookTimeoutMs) });
      const responseBody = (await res.text().catch(() => '')).slice(0,2000); const attempt = item.attempt_count + 1;
      this.recordAttempt(item.id,attempt,res.status,responseBody,null,Date.now()-startedAt);
      if (res.ok) db.prepare('UPDATE webhook_deliveries SET status=?,attempt_count=?,response_code=?,response_body=?,last_error=NULL,delivered_at=?,updated_at=? WHERE id=?').run('DELIVERED',attempt,res.status,responseBody,now(),now(),item.id);
      else this.scheduleRetry(item,attempt,`HTTP ${res.status}`,res.status,responseBody);
    } catch (error) { const attempt=item.attempt_count + 1; this.recordAttempt(item.id,attempt,null,null,error.message,Date.now()-startedAt); this.scheduleRetry(item,attempt,error.message,null,null); }
  }
  recordAttempt(deliveryId,attempt,responseCode,responseBody,error,latencyMs) {
    db.prepare('INSERT INTO webhook_attempts (id,delivery_id,attempt_number,response_code,response_body,error,latency_ms,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id('wha'),deliveryId,attempt,responseCode,responseBody,error,latencyMs,now());
  }
  scheduleRetry(item, attempt, error, code, body) {
    const delay = config.webhookRetries[attempt]; const status = delay == null ? 'DEAD_LETTER' : 'RETRYING'; const next = delay == null ? null : new Date(Date.now() + delay * 1000).toISOString();
    db.prepare('UPDATE webhook_deliveries SET status=?,attempt_count=?,response_code=?,response_body=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=?').run(status,attempt,code,body,error,next,now(),item.id);
  }
  replay(deliveryId, overrideUrl = null) {
    const original=db.prepare('SELECT * FROM webhook_deliveries WHERE id=?').get(deliveryId);
    if(!original) throw Object.assign(new Error('Delivery tidak ditemukan.'),{status:404});
    const payment=db.prepare('SELECT p.*,m.webhook_secret,m.api_key_hash FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE p.id=?').get(original.payment_id);
    const timestamp=now(),newId=id('dlv'),secret=payment.webhook_secret||payment.api_key_hash;
    const signature=crypto.createHmac('sha256',secret).update(original.payload_json).digest('hex');
    const target=overrideUrl?validateOutboundUrl(overrideUrl).toString():original.url;
    db.prepare('INSERT INTO webhook_deliveries (id,payment_id,url,payload_json,status,event_type,next_attempt_at,signature,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(newId,original.payment_id,target,original.payload_json,'PENDING',original.event_type,timestamp,signature,timestamp,timestamp);
    void this.deliver(newId); return { queued:true, delivery_id:newId, replay_of:original.id };
  }
  async processDue() { const due = db.prepare("SELECT id FROM webhook_deliveries WHERE status IN ('PENDING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at<=?) LIMIT 25").all(now()); await Promise.allSettled(due.map((x) => this.deliver(x.id))); return due.length; }
}
