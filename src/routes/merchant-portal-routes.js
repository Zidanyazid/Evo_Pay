import { Router } from 'express';
import db from '../database.js';
import { authorize } from '../middleware/authorization.js';
import { requirePermission } from '../middleware/permissions.js';
import { audit } from '../services/audit-service.js';

const auth=authorize();
const page=(value,fallback=1)=>Math.max(1,Number.parseInt(value,10)||fallback);
async function merchant(id){return db.get('SELECT id,name,callback_url,is_active,created_at FROM merchants WHERE id=?',[id]);}
function assertMerchant(row){if(!row)throw Object.assign(new Error('Project tidak ditemukan.'),{status:404});return row;}
const log=(req,action,targetId,metadata)=>audit(action,{actorId:req.admin.user_id,targetType:'merchant',targetId,ip:req.ip,userAgent:req.get('user-agent'),metadata});

export default function merchantPortalRoutes(webhooks){const router=Router();
 router.use(auth);
 router.get('/:merchantId/overview',requirePermission('overview:read'),async(req,res,next)=>{try{const m=assertMerchant(await merchant(req.params.merchantId));const [totals,methods,deliveries]=await Promise.all([
  db.get("SELECT COUNT(*) total,SUM(status='PAID') paid,SUM(status='PENDING') pending,COALESCE(SUM(CASE WHEN status='PAID' THEN net_amount ELSE 0 END),0) available,COALESCE(SUM(CASE WHEN status='PENDING' THEN net_amount ELSE 0 END),0) clearing FROM payments WHERE merchant_id=?",[m.id]),
  db.all("SELECT payment_method,COUNT(*) transactions,COALESCE(SUM(total_amount),0) nominal FROM payments WHERE merchant_id=? AND created_at>=? GROUP BY payment_method ORDER BY nominal DESC LIMIT 6",[m.id,new Date(Date.now()-29*86400000).toISOString()]),
  db.get("SELECT COUNT(*) total,SUM(status='DELIVERED') delivered,SUM(status IN ('RETRYING','DEAD_LETTER')) attention FROM webhook_deliveries d JOIN payments p ON p.id=d.payment_id WHERE p.merchant_id=?",[m.id])
 ]);res.json({data:{merchant:m,totals:{...totals,success_rate:totals.total?Number(totals.paid)/Number(totals.total)*100:0},methods,webhooks:{total:Number(deliveries.total||0),delivered:Number(deliveries.delivered||0),attention:Number(deliveries.attention||0)}}});}catch(e){next(e)}});
 router.get('/:merchantId/ledger',requirePermission('payments:read'),async(req,res,next)=>{try{const m=assertMerchant(await merchant(req.params.merchantId));const limit=Math.min(100,Math.max(10,page(req.query.limit,30)));const current=page(req.query.page);const offset=(current-1)*limit;const [rows,count]=await Promise.all([db.all("SELECT le.id,lt.id transaction_id,lt.reference_type,lt.reference_id,lt.description,le.direction,le.amount,le.created_at,la.code account_code,la.name account_name FROM ledger_entries le JOIN ledger_transactions lt ON lt.id=le.transaction_id JOIN ledger_accounts la ON la.id=le.account_id WHERE la.merchant_id=? ORDER BY le.created_at DESC LIMIT ? OFFSET ?",[m.id,limit,offset]),db.get('SELECT COUNT(*) total FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.account_id WHERE la.merchant_id=?',[m.id])]);res.json({data:rows,meta:{page:current,limit,total:Number(count.total),pages:Math.max(1,Math.ceil(Number(count.total)/limit))}});}catch(e){next(e)}});
 router.get('/:merchantId/settlements',requirePermission('merchants:read'),async(req,res,next)=>{try{assertMerchant(await merchant(req.params.merchantId));res.json({data:await db.all('SELECT id,amount,status,notes,created_at,updated_at FROM settlements WHERE merchant_id=? ORDER BY created_at DESC LIMIT 200',[req.params.merchantId])});}catch(e){next(e)}});
 router.post('/:merchantId/deliveries/:deliveryId/replay',requirePermission('webhooks:write'),async(req,res,next)=>{try{assertMerchant(await merchant(req.params.merchantId));const delivery=await db.get('SELECT d.id FROM webhook_deliveries d JOIN payments p ON p.id=d.payment_id WHERE d.id=? AND p.merchant_id=?',[req.params.deliveryId,req.params.merchantId]);if(!delivery)throw Object.assign(new Error('Webhook project tidak ditemukan.'),{status:404});const data=await webhooks.replay(delivery.id);await log(req,'webhook.replayed',req.params.merchantId,{delivery_id:delivery.id,replay_id:data.delivery_id});res.status(202).json({data});}catch(e){next(e)}});
 return router;
}
