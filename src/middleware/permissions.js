export const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  finance: ['overview:read','payments:read','finance:read','refunds:write','settlements:write','reports:read','reports:write','reconciliation:write','billing:read','billing:write','notifications:read','customers:read','invoices:read','invoices:write','promotions:read','disputes:read','operations:read','approvals:read','approvals:write','approvals:decide','governance:read','audit:read','audit:export'],
  developer: ['overview:read','payments:read','merchants:read','merchants:write','credentials:read','credentials:write','webhooks:read','webhooks:write','developer:read','developer:write','notifications:read','operations:read','risk:read','governance:read','audit:read'],
  support: ['overview:read','payments:read','payments:note','customers:read','customers:write','invoices:read','disputes:read','disputes:write','notifications:read','billing:read','risk:read','approvals:read'],
  viewer: ['overview:read','payments:read','merchants:read','analytics:read','reports:read','billing:read','notifications:read','customers:read','invoices:read','promotions:read','operations:read','disputes:read','governance:read']
});
export const hasPermission=(role,permission)=>{const values=ROLE_PERMISSIONS[String(role||'').toLowerCase()]||[];return values.includes('*')||values.includes(permission)};
export function requirePermission(...permissions){return(req,res,next)=>permissions.every(value=>hasPermission(req.admin?.role,value))?next():res.status(403).json({error:{code:'FORBIDDEN',message:'Anda tidak memiliki izin untuk tindakan ini.'}})}
