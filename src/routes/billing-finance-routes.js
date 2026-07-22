import { Router } from 'express';
import { authorize } from '../middleware/authorization.js';
import { requirePermission } from '../middleware/permissions.js';

export default function billingFinanceRoutes(service, jobs) {
  const router = Router(), auth = authorize();
  router.use(auth);
  router.get('/recurring/plans', requirePermission('billing:read'), async (q, s, n) => { try { s.json({ data: await service.plans(q.query.merchant_id || 'm_demo_topup') }); } catch (e) { n(e); } });
  router.post('/recurring/plans', requirePermission('billing:write'), async (q, s, n) => { try { s.status(201).json({ data: await service.createPlan(q.body.merchant_id || 'm_demo_topup', q.body) }); } catch (e) { n(e); } });
  router.get('/recurring/subscriptions', requirePermission('billing:read'), async (q, s, n) => { try { s.json({ data: await service.subscriptions(q.query.merchant_id || 'm_demo_topup') }); } catch (e) { n(e); } });
  router.post('/recurring/subscriptions', requirePermission('billing:write'), async (q, s, n) => { try { s.status(201).json({ data: await service.subscribe(q.body.merchant_id || 'm_demo_topup', q.body, jobs) }); } catch (e) { n(e); } });
  router.post('/recurring/subscriptions/:id/:action', requirePermission('billing:write'), async (q, s, n) => { try { s.json({ data: await service.transition(q.params.id, q.params.action) }); } catch (e) { n(e); } });
  router.get('/reports', requirePermission('reports:read'), async (q, s, n) => { try { s.json({ data: await service.reports(q.admin.user_id) }); } catch (e) { n(e); } });
  router.post('/reports', requirePermission('reports:write'), async (q, s, n) => { try { s.status(201).json({ data: await service.createReport(q.admin.user_id, q.body) }); } catch (e) { n(e); } });
  router.post('/reports/:id/run', requirePermission('reports:read'), async (q, s, n) => { try { s.json({ data: await service.runReport(q.params.id) }); } catch (e) { n(e); } });
  router.post('/reconciliation/:provider/import', requirePermission('reconciliation:write'), async (q, s, n) => { try { s.status(201).json({ data: await service.reconcile(q.params.provider, q.body) }); } catch (e) { n(e); } });
  router.get('/forecast/:merchantId', requirePermission('reports:read'), async (q, s, n) => { try { s.json({ data: await service.forecast(q.params.merchantId, Math.min(365, Number(q.query.days) || 30)) }); } catch (e) { n(e); } });
  return router;
}
