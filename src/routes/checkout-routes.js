import { Router } from 'express';
import { publicPayment } from '../services/payment-service.js';
export default function checkoutRoutes(payments) {
  const router = Router();
  router.get('/:token', async (req, res, next) => {
    try { const payment = await payments.findCheckout(req.params.token); if (!payment) return res.status(404).json({ error: { message: 'Payment link tidak ditemukan.' } }); res.set('Cache-Control', 'no-store'); res.json({ data: { ...publicPayment(payment), merchant_name: payment.merchant_name, redirect_url: payment.redirect_url, brand: payment.brand_json ? JSON.parse(payment.brand_json) : null } }); } catch (error) { next(error); }
  });
  router.post('/:token/sync', async (req, res, next) => { try { const payment = await payments.findCheckout(req.params.token); if (!payment) return res.status(404).json({ error: { message: 'Payment link tidak ditemukan.' } }); const updated = payment.status === 'PENDING' ? await payments.sync(payment) : payment; res.json({ data: publicPayment(updated) }); } catch (error) { next(error); } });
  return router;
}
