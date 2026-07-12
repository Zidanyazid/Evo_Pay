import { Router } from 'express';
import db from '../database.js';
import { authorize } from '../middleware/authorization.js';
import { audit } from '../services/audit-service.js';

export default function financeRoutes(finance) {
  const router = Router(); const anyUser = authorize(); const financeUser = authorize('owner', 'finance'); const owner = authorize('owner');
  const log = (req, action, targetType, targetId, metadata) => audit(action, { actorId: req.admin.user_id, targetType, targetId, ip: req.ip, userAgent: req.get('user-agent'), metadata });
  router.get('/balances', anyUser, async (req, res, next) => { try { const merchants = await db.all('SELECT id,name FROM merchants ORDER BY name'); const data = await Promise.all(merchants.map(async (merchant) => ({ merchant, ...await finance.balance(merchant.id) }))); res.json({ data }); } catch (error) { next(error); } });
  router.get('/refunds', anyUser, async (req, res, next) => { try { res.json({ data: await db.all('SELECT r.*,p.merchant_order_id,m.name merchant_name FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN merchants m ON m.id=r.merchant_id ORDER BY r.created_at DESC LIMIT 500') }); } catch (error) { next(error); } });
  router.post('/payments/:paymentId/refunds', financeUser, async (req, res, next) => { try { const data = await finance.refund(req.params.paymentId, { amount: req.body.amount, reason: req.body.reason, requestedBy: req.admin.user_id, idempotencyKey: req.get('idempotency-key') }); log(req, 'refund.requested', 'refund', data.id, { payment_id: req.params.paymentId, amount: data.amount, status: data.status }); res.status(201).json({ data }); } catch (error) { next(error); } });
  router.get('/settlements', anyUser, async (req, res, next) => { try { res.json({ data: await db.all('SELECT s.*,m.name merchant_name FROM settlements s JOIN merchants m ON m.id=s.merchant_id ORDER BY s.created_at DESC LIMIT 500') }); } catch (error) { next(error); } });
  router.post('/merchants/:merchantId/settlements', financeUser, async (req, res, next) => { try { const data = await finance.requestSettlement(req.params.merchantId, { amount: req.body.amount, destination: req.body.destination, requestedBy: req.admin.user_id }); log(req, 'settlement.requested', 'settlement', data.id, { merchant_id: req.params.merchantId, amount: data.amount }); res.status(201).json({ data }); } catch (error) { next(error); } });
  router.post('/settlements/:settlementId/approve', owner, async (req, res, next) => { try { const data = await finance.approveSettlement(req.params.settlementId, req.admin.user_id); log(req, 'settlement.approved', 'settlement', data.id, { amount: data.amount }); res.json({ data }); } catch (error) { next(error); } });
  return router;
}
