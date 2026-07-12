import { Router } from 'express';

const normalizedIp = (ip = '') => ip.replace(/^::ffff:/, '');

export default function tokopayWebhookRoutes(service) {
  const router = Router();
  router.post('/tokopay', async (req, res) => {
    const allowedIps = (process.env.TOKOPAY_WEBHOOK_IPS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (allowedIps.length && !allowedIps.includes(normalizedIp(req.ip))) {
      console.warn(`[tokopay webhook] blocked source IP: ${req.ip}`);
      return res.json({ status: true });
    }
    service.handleTokopay(req.body || {}).catch((error) => console.error('[tokopay webhook]', error.message));
    res.json({ status: true });
  });
  return router;
}
