import crypto from 'node:crypto';
import db from '../database.js';
const cookieName='nexus_admin_session';
const parseCookies=(header='')=>Object.fromEntries(header.split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
const tokenHash=(token)=>crypto.createHash('sha256').update(token).digest('hex');
export function authorize(...roles){return async(req,res,next)=>{try{const token=parseCookies(req.headers.cookie)[cookieName];if(!token)return res.status(401).json({error:{message:'Login admin diperlukan.'}});const session=await db.get(`SELECT s.*,u.email,u.name,u.is_active,u.email_verified_at,u.totp_enabled,w.id workspace_id,w.name workspace_name,wm.role FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id JOIN workspace_members wm ON wm.user_id=u.id AND wm.workspace_id=s.active_workspace_id AND wm.is_active=1 JOIN workspaces w ON w.id=wm.workspace_id WHERE s.token_hash=? AND s.expires_at>?`,[tokenHash(token),new Date().toISOString()]);if(!session||!session.is_active)return res.status(401).json({error:{message:'Login admin diperlukan.'}});if(roles.length&&!roles.includes(session.role))return res.status(403).json({error:{message:'Anda tidak memiliki izin untuk tindakan ini.'}});req.admin=session;req.adminToken=token;next();}catch(error){next(error)}}}
export {cookieName,tokenHash};
