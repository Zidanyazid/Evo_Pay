import { Router } from 'express';
import { authorize } from '../middleware/authorization.js';
import { requirePermission } from '../middleware/permissions.js';

export default function commerceRoutes(links, payments, commerce, jobs) {
  const router = Router(); const auth = authorize();
  router.get('/links', auth, requirePermission('merchants:read'), (req,res) => res.json({ data: links.list(req.query.merchant_id || 'm_demo_topup') }));
  router.post('/links', auth, requirePermission('merchants:write'), (req,res,next) => { try { res.status(201).json({ data: links.create(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch(e) { next(e); } });
  router.patch('/links/:id', auth, requirePermission('merchants:write'), (req,res,next) => { try { res.json({ data: links.update(req.params.id, req.body) }); } catch(e) { next(e); } });
  router.get('/customers', auth, requirePermission('customers:read'), (req,res) => res.json({ data: commerce.customers(req.query.merchant_id || 'm_demo_topup') }));
  router.post('/customers', auth, requirePermission('customers:write'), (req,res,next) => { try { res.status(201).json({ data: commerce.saveCustomer(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch(e) { next(e); } });
  router.patch('/customers/:id', auth, requirePermission('customers:write'), (req,res,next) => { try { res.json({ data: commerce.saveCustomer(req.body.merchant_id || 'm_demo_topup', { ...req.body, id:req.params.id }) }); } catch(e) { next(e); } });
  router.get('/invoices', auth, requirePermission('invoices:read'), (req,res) => res.json({ data: commerce.invoices(req.query.merchant_id || 'm_demo_topup') }));
  router.get('/invoices/:id', auth, requirePermission('invoices:read'), (req,res) => { const data=commerce.invoice(req.params.id); return data?res.json({data}):res.status(404).json({error:{message:'Invoice tidak ditemukan.'}}); });
  router.post('/invoices', auth, requirePermission('invoices:write'), (req,res,next) => { try { res.status(201).json({ data: commerce.createInvoice(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch(e) { next(e); } });
  router.post('/invoices/:id/send', auth, requirePermission('invoices:write'), (req,res,next) => { try { res.json({ data: commerce.sendInvoice(req.params.id, jobs) }); } catch(e) { next(e); } });
  router.get('/promotions', auth, requirePermission('promotions:read'), (req,res) => res.json({ data: commerce.promotions(req.query.merchant_id || 'm_demo_topup') }));
  router.post('/promotions', auth, requirePermission('promotions:write'), (req,res,next) => { try { res.status(201).json({ data: commerce.createPromotion(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch(e) { next(e); } });
  router.post('/promotions/preview', auth, requirePermission('promotions:read'), (req,res,next) => { try { res.json({ data: commerce.previewPromotion(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch(e) { next(e); } });
  router.get('/branding/:merchantId', auth, requirePermission('merchants:read'), (req,res) => res.json({ data: commerce.branding(req.params.merchantId) }));
  router.put('/branding/:merchantId', auth, requirePermission('merchants:write'), (req,res) => res.json({ data: commerce.branding(req.params.merchantId, req.body) }));
  router.get('/public/links/:slug', (req,res) => { const data=links.get(req.params.slug); if(!data) return res.status(404).json({error:{message:'Payment link tidak ditemukan.'}}); res.json({data}); });
  router.post('/public/links/:slug/checkout', async(req,res,next) => { try { res.status(201).json({ data:await links.checkout(req.params.slug,req.body,payments) }); } catch(e) { next(e); } });
  router.get('/public/portal/:token', (req,res) => { const data=commerce.portalInvoice(req.params.token); return data?res.json({data}):res.status(404).json({error:{message:'Portal tidak ditemukan atau tautan tidak valid.'}}); });
  return router;
}
