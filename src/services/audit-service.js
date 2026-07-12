import db, { id, now } from '../database.js';
const hidden = new Set(['password', 'api_key', 'secret', 'token']);
function sanitize(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hidden.has(key.toLowerCase()) ? '[REDACTED]' : (typeof item === 'object' ? sanitize(item) : item)]));
}
export async function audit(action, { actorId = null, targetType = null, targetId = null, ip = null, userAgent = null, metadata = null } = {}) {
  await db.run('INSERT INTO audit_logs (id,actor_id,action,target_type,target_id,ip,user_agent,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [id('aud'), actorId, action, targetType, targetId, ip, userAgent, metadata ? JSON.stringify(sanitize(metadata)) : null, now()]);
}
