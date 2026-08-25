import crypto from 'node:crypto';
import db, { hashApiKey, id, now } from '../database.js';
import { encryptSecret } from './security-service.js';

const VALID_ENVIRONMENTS = new Set(['sandbox', 'live']);
const VALID_SCOPES = new Set(['payments:read', 'payments:write', 'payments:sync', 'refunds:read', 'refunds:write', 'webhooks:read', 'webhooks:write', 'reports:read']);
const publicCredential = (row) => ({ id: row.id, merchant_id: row.merchant_id, name: row.name, key_prefix: row.key_prefix, environment: row.environment, scopes: JSON.parse(row.scopes_json), expires_at: row.expires_at, last_used_at: row.last_used_at, revoked_at: row.revoked_at, rotation_parent_id: row.rotation_parent_id, overlap_ends_at: row.overlap_ends_at, created_at: row.created_at });
const serviceError = (message, status) => Object.assign(new Error(message), { status });

export class CredentialService {
  async list(merchantId) { return (await db.all('SELECT * FROM api_credentials WHERE merchant_id=? ORDER BY created_at DESC', [merchantId])).map(publicCredential); }

  async create({ merchantId, name, environment = 'sandbox', scopes = ['payments:read', 'payments:write'], expiresAt = null, rotationParentId = null, overlapEndsAt = null }) {
    if (!name?.trim()) throw serviceError('Nama credential wajib diisi.', 422);
    if (!VALID_ENVIRONMENTS.has(environment)) throw serviceError('Environment credential tidak valid.', 422);
    const cleanScopes = [...new Set(scopes)];
    if (!cleanScopes.length || cleanScopes.some((scope) => !VALID_SCOPES.has(scope))) throw serviceError('Scope credential tidak valid.', 422);
    if (environment === 'live') {
      const merchant = await db.get('SELECT onboarding_status FROM merchants WHERE id=?', [merchantId]);
      if (merchant?.onboarding_status !== 'APPROVED') throw serviceError('Credential live hanya tersedia untuk merchant yang telah disetujui.', 409);
    }
    const secret = `np_${environment}_${crypto.randomBytes(24).toString('base64url')}`;
    const row = { id: id('cred'), merchantId, name: name.trim(), prefix: secret.slice(0, 18), environment, scopes: JSON.stringify(cleanScopes), expiresAt, secretEncrypted: encryptSecret(secret), rotationParentId, overlapEndsAt, createdAt: now() };
    await db.run('INSERT INTO api_credentials (id,merchant_id,name,key_prefix,key_hash,secret_encrypted,environment,scopes_json,expires_at,rotation_parent_id,overlap_ends_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [row.id, row.merchantId, row.name, row.prefix, hashApiKey(secret), row.secretEncrypted, row.environment, row.scopes, row.expiresAt, row.rotationParentId, row.overlapEndsAt, row.createdAt]);
    return { ...publicCredential(await db.get('SELECT * FROM api_credentials WHERE id=?', [row.id])), secret };
  }

  async rotate(credentialId, overlapHours = 24) {
    const old = await db.get('SELECT * FROM api_credentials WHERE id=? AND revoked_at IS NULL', [credentialId]);
    if (!old) throw serviceError('Credential aktif tidak ditemukan.', 404);
    const hours = Math.min(168, Math.max(0, Number(overlapHours) || 0));
    const overlapEndsAt = new Date(Date.now() + hours * 3_600_000).toISOString();
    await db.run('UPDATE api_credentials SET overlap_ends_at=? WHERE id=?', [overlapEndsAt, old.id]);
    return this.create({ merchantId: old.merchant_id, name: `${old.name} (rotated)`, environment: old.environment, scopes: JSON.parse(old.scopes_json), expiresAt: old.expires_at, rotationParentId: old.id, overlapEndsAt });
  }

  async revoke(credentialId) {
    const result = await db.run('UPDATE api_credentials SET revoked_at=? WHERE id=? AND revoked_at IS NULL', [now(), credentialId]);
    if (!result.changes) throw serviceError('Credential aktif tidak ditemukan.', 404);
    return publicCredential(await db.get('SELECT * FROM api_credentials WHERE id=?', [credentialId]));
  }
}
