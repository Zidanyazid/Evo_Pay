import {Router} from 'express';
import db from '../database.js';
import {authorize} from '../middleware/authorization.js';
import {requirePermission} from '../middleware/permissions.js';
import {audit} from '../services/audit-service.js';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const project=async merchantId=>{const row=await db.get('SELECT id FROM merchants WHERE id=?',[merchantId]);if(!row)fail('Project tidak ditemukan.',404);return row;};
const owned=async(table,id,merchantId)=>db.get(`SELECT id FROM ${table} WHERE id=? AND merchant_id=?`,[id,merchantId]);
const log=(req,action,merchantId,metadata)=>audit(action,{actorId:req.admin.user_id,targetType:'merchant',targetId:merchantId,ip:req.ip,userAgent:req.get('user-agent'),metadata});
export default function projectCommerceRoutes(links,commerce,jobs){const router=Router();router.use(authorize());router.param('merchantId',async(req,res,next,value)=>{try{const row=await db.get('SELECT id FROM merchants WHERE id=? AND workspace_id=?',[value,req.admin.workspace_id]);if(!row)return res.status(404).json({error:{message:'Project tidak ditemukan.'}});next();}catch(error){next(error)}});
 router.get('/:merchantId/links',requirePermission('merchants:read'),async(req,res,next)=>{try{await project(req.params.merchantId);res.json({data:await links.list(req.params.merchantId)});}catch(error){next(error)}});
 router.post('/:merchantId/links',requirePermission('merchants:write'),async(req,res,next)=>{try{await project(req.params.merchantId);const data=await links.create(req.params.merchantId,req.body);await log(req,'payment_link.created',req.params.merchantId,{link_id:data.id});res.status(201).json({data});}catch(error){next(error)}});
 router.patch('/:merchantId/links/:linkId',requirePermission('merchants:write'),async(req,res,next)=>{try{await project(req.params.merchantId);if(!await owned('payment_links',req.params.linkId,req.params.merchantId))fail('Payment link project tidak ditemukan.',404);const data=await links.update(req.params.linkId,req.body);await log(req,'payment_link.updated',req.params.merchantId,{link_id:data.id});res.json({data});}catch(error){next(error)}});
 router.get('/:merchantId/invoices',requirePermission('invoices:read'),async(req,res,next)=>{try{await project(req.params.merchantId);res.json({data:await commerce.invoices(req.params.merchantId)});}catch(error){next(error)}});
 router.post('/:merchantId/invoices',requirePermission('invoices:write'),async(req,res,next)=>{try{await project(req.params.merchantId);const data=await commerce.createInvoice(req.params.merchantId,req.body);await log(req,'invoice.created',req.params.merchantId,{invoice_id:data.id});res.status(201).json({data});}catch(error){next(error)}});
 router.post('/:merchantId/invoices/:invoiceId/send',requirePermission('invoices:write'),async(req,res,next)=>{try{await project(req.params.merchantId);if(!await owned('invoices',req.params.invoiceId,req.params.merchantId))fail('Invoice project tidak ditemukan.',404);const data=await commerce.sendInvoice(req.params.invoiceId,jobs);await log(req,'invoice.sent',req.params.merchantId,{invoice_id:req.params.invoiceId});res.json({data});}catch(error){next(error)}});
 router.get('/:merchantId/branding',requirePermission('merchants:read'),async(req,res,next)=>{try{await project(req.params.merchantId);res.json({data:await commerce.branding(req.params.merchantId)});}catch(error){next(error)}});
 router.put('/:merchantId/branding',requirePermission('merchants:write'),async(req,res,next)=>{try{await project(req.params.merchantId);const data=await commerce.branding(req.params.merchantId,req.body);await log(req,'checkout_branding.updated',req.params.merchantId,{});res.json({data});}catch(error){next(error)}});
 return router;}
