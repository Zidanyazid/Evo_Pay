import crypto from 'node:crypto';import db from '../database.js';
export const cookieName='evopay_session';export const tokenHash=(token)=>crypto.createHash('sha256').update(token).digest('hex');
const cookies=(value='')=>Object.fromEntries(value.split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
export function authorize(){return async(req,res,next)=>{try{const token=cookies(req.headers.cookie)[cookieName];if(!token)return res.status(401).json({error:{message:'Login diperlukan.'}});const session=await db.get('SELECT * FROM gateway_sessions WHERE token_hash=? AND expires_at>?',[tokenHash(token),new Date()]);if(!session)return res.status(401).json({error:{message:'Sesi tidak valid.'}});req.adminToken=token;next();}catch(error){next(error);}}}
