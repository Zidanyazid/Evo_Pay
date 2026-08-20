import { Router } from 'express';
import { log } from '../observability.js';

const normalizedIp = (ip = '') => ip.replace(/^::ffff:/, '');

export default function tokopayWebhookRoutes(service) {
  const router = Router();
  router.post('/tokopay', async (req, res) => {
    const allowedIps = (process.env.TOKOPAY_WEBHOOK_IPS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (allowedIps.length && !allowedIps.includes(normalizedIp(req.ip))) {
      log('warn', 'tokopay_webhook_blocked', { request_id: req.id, ip: req.ip });
      return res.json({ status: true });
    }
    service.handleTokopay(req.body || {}).then((result) => log(result.accepted ? 'info' : 'warn', 'tokopay_webhook_processed', { request_id: req.id, accepted: result.accepted, payment_id: result.payment?.id || null })).catch((error) => log('error', 'tokopay_webhook_error', { request_id: req.id, message: error.message }));
    res.json({ status: true });
  });
  return router;
}
