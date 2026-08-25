import {log,metrics} from '../observability.js';
export const maintenanceError=(site)=>({code:'SITE_MAINTENANCE',message:'Pembayaran sementara tidak tersedia untuk Site ini.',retry_after_seconds:300});
export function maintenanceGuard(req,res,next){if(!req.site?.maintenance_enabled)return next();metrics.increment('evopay_payment_create_total',{outcome:'maintenance'});log('warn','payment_create_maintenance_blocked',{site_id:req.site.id,request_id:req.requestId});res.set('Retry-After','300').status(503).json({error:maintenanceError(req.site)});}
