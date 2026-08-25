import { Router } from 'express';
import { authorize } from '../middleware/authorization.js';
import { requirePermission } from '../middleware/permissions.js';

export default function commerceRoutes(links, payments, commerce, jobs, vault) {
  const router = Router(); const auth = authorize();
  router.get('/links', auth, requirePermission('merchants:read'), async (req, res, next) => { try { res.json({ data: await links.list(req.query.merchant_id || 'm_demo_topup') }); } catch (error) { next(error); } });
  router.post('/links', auth, requirePermission('merchants:write'), async (req, res, next) => { try { res.status(201).json({ data: await links.create(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch (error) { next(error); } });
  router.patch('/links/:id', auth, requirePermission('merchants:write'), async (req, res, next) => { try { res.json({ data: await links.update(req.params.id, req.body) }); } catch (error) { next(error); } });
  router.get('/customers', auth, requirePermission('customers:read'), async (req, res, next) => { try { res.json({ data: await commerce.customers(req.query.merchant_id || 'm_demo_topup') }); } catch (error) { next(error); } });
  router.post('/customers', auth, requirePermission('customers:write'), async (req, res, next) => { try { res.status(201).json({ data: await commerce.saveCustomer(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch (error) { next(error); } });
  router.patch('/customers/:id', auth, requirePermission('customers:write'), async (req, res, next) => { try { res.json({ data: await commerce.saveCustomer(req.body.merchant_id || 'm_demo_topup', { ...req.body, id: req.params.id }) }); } catch (error) { next(error); } });
  router.get('/invoices', auth, requirePermission('invoices:read'), async (req, res, next) => { try { res.json({ data: await commerce.invoices(req.query.merchant_id || 'm_demo_topup') }); } catch (error) { next(error); } });
  router.get('/invoices/:id', auth, requirePermission('invoices:read'), async (req, res, next) => { try { const data = await commerce.invoice(req.params.id); return data ? res.json({ data }) : res.status(404).json({ error: { message: 'Invoice tidak ditemukan.' } }); } catch (error) { next(error); } });
  router.post('/invoices', auth, requirePermission('invoices:write'), async (req, res, next) => { try { res.status(201).json({ data: await commerce.createInvoice(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch (error) { next(error); } });
  router.post('/invoices/:id/send', auth, requirePermission('invoices:write'), async (req, res, next) => { try { res.json({ data: await commerce.sendInvoice(req.params.id, jobs) }); } catch (error) { next(error); } });
  router.get('/promotions', auth, requirePermission('promotions:read'), async (req, res, next) => { try { res.json({ data: await commerce.promotions(req.query.merchant_id || 'm_demo_topup') }); } catch (error) { next(error); } });
  router.post('/promotions', auth, requirePermission('promotions:write'), async (req, res, next) => { try { res.status(201).json({ data: await commerce.createPromotion(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch (error) { next(error); } });
  router.post('/promotions/preview', auth, requirePermission('promotions:read'), async (req, res, next) => { try { res.json({ data: await commerce.previewPromotion(req.body.merchant_id || 'm_demo_topup', req.body) }); } catch (error) { next(error); } });
  router.get('/branding/:merchantId', auth, requirePermission('merchants:read'), async (req, res, next) => { try { res.json({ data: await commerce.branding(req.params.merchantId) }); } catch (error) { next(error); } });
  router.put('/branding/:merchantId', auth, requirePermission('merchants:write'), async (req, res, next) => { try { res.json({ data: await commerce.branding(req.params.merchantId, req.body) }); } catch (error) { next(error); } });
  router.get('/public/links/:slug', async (req, res, next) => { try { const data = await links.get(req.params.slug); if (!data) return res.status(404).json({ error: { message: 'Payment link tidak ditemukan.' } }); res.json({ data }); } catch (error) { next(error); } });
  router.post('/public/links/:slug/checkout', async (req, res, next) => { try { res.status(201).json({ data: await links.checkout(req.params.slug, req.body, payments) }); } catch (error) { next(error); } });
  router.get('/public/portal/:token', async (req, res, next) => { try { const data = await commerce.portalInvoice(req.params.token); return data ? res.json({ data }) : res.status(404).json({ error: { message: 'Portal tidak ditemukan atau tautan tidak valid.' } }); } catch (error) { next(error); } });
  router.get('/customers/:customerId/payment-methods', auth, requirePermission('customers:read'), async(req,res,next)=>{try{res.json({data:await vault.list(req.admin.workspace_id,req.query.merchant_id,req.params.customerId,req.admin.user_id)})}catch(error){next(error)}});
  router.post('/customers/:customerId/payment-methods', auth, requirePermission('customers:write'), async(req,res,next)=>{try{res.status(201).json({data:await vault.store(req.admin.workspace_id,req.body.merchant_id,{...req.body,customer_id:req.params.customerId},req.admin.user_id)})}catch(error){next(error)}});
  router.delete('/customers/:customerId/payment-methods/:methodId', auth, requirePermission('customers:write'), async(req,res,next)=>{try{res.json({data:await vault.revoke(req.admin.workspace_id,req.query.merchant_id,req.params.methodId,req.admin.user_id)})}catch(error){next(error)}});
  return router;
}
