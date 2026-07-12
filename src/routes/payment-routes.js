import { Router } from 'express';
import { publicPayment } from '../services/payment-service.js';
import { merchantAuth } from '../middleware/merchant-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { idempotency } from '../middleware/idempotency.js';
import { config } from '../config.js';
import { PaymentMethodService } from '../services/payment-method-service.js';
const validAmount = (amount) => Number.isInteger(amount) && amount >= 1;
export default function paymentRoutes(service) {
  const router = Router();
  const merchantLimit = rateLimit({ limit: config.rateLimit });
  const methods = new PaymentMethodService();
  router.use(merchantAuth, merchantLimit);
  router.get('/payment-methods', (req,res)=>res.json({ data:methods.list(req.merchant.id) }));
  router.post('/payments', idempotency, async (req, res, next) => {
    const { order_id, amount, payment_method } = req.body || {};
    if (!order_id || !validAmount(amount) || !payment_method) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'order_id, amount bilangan bulat positif, dan payment_method wajib valid.' } });
    try { const result = await service.create(req.merchant, req.body); res.status(result.duplicate ? 200 : 201).json({ data: publicPayment(result.payment), duplicate: result.duplicate }); } catch (error) { next(error); }
  });
  router.get('/payments/:paymentId', (req, res) => {
    const payment = service.findForMerchant(req.merchant.id, req.params.paymentId);
    if (!payment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' } });
    res.json({ data: publicPayment(payment) });
  });
  router.post('/payments/:paymentId/sync', async (req, res, next) => {
    const payment = service.findForMerchant(req.merchant.id, req.params.paymentId);
    if (!payment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' } });
    try { res.json({ data: publicPayment(await service.sync(payment)) }); } catch (error) { next(error); }
  });
  return router;
}
