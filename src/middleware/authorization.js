import crypto from 'node:crypto';
import db from '../database.js';
const cookieName='nexus_admin_session';
const parseCookies=(header='')=>Object.fromEntries(header.split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
const tokenHash=(token)=>crypto.createHash('sha256').update(token).digest('hex');
export function authorize(...roles){return (req,res,next)=>{const token=parseCookies(req.headers.cookie)[cookieName];const session=token&&db.prepare(`SELECT s.*,u.email,u.name,u.role,u.is_active FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token),new Date().toISOString());if(!session||!session.is_active)return res.status(401).json({error:{message:'Login admin diperlukan.'}});if(roles.length&&!roles.includes(session.role))return res.status(403).json({error:{message:'Anda tidak memiliki izin untuk tindakan ini.'}});req.admin=session;req.adminToken=token;next()}}
export { cookieName, tokenHash };
