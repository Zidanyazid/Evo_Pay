import { config } from '../config.js';
const unsafe=new Set(['POST','PUT','PATCH','DELETE']);
export function sameOrigin(req,res,next){if(process.env.NODE_ENV!=='production'||!unsafe.has(req.method)||!req.headers.cookie)return next();const origin=req.get('origin');let expected;try{expected=new URL(config.baseUrl).origin}catch{return res.status(500).json({error:{code:'SERVER_CONFIG_ERROR',message:'Origin aplikasi tidak valid.'}})}if(!origin||origin==='null'||origin!==expected)return res.status(403).json({error:{code:'CSRF_ORIGIN_REJECTED',message:'Origin request tidak diizinkan.'}});next();}
