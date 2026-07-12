import db, { hashApiKey } from '../database.js';
import { verifySignedRequest } from '../services/security-service.js';
import { ipAllowlistService } from '../services/ip-allowlist-service.js';
export function merchantAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bearer API key wajib diisi.' } });
  const merchant = db.prepare('SELECT * FROM merchants WHERE api_key_hash=? AND is_active=1').get(hashApiKey(token));
  if (!merchant) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'API key tidak valid.' } });
  const access=ipAllowlistService.evaluate(merchant,req.ip);
  if (!access.allowed) return res.status(403).json({ error: { code: 'IP_NOT_ALLOWED', message: 'Alamat IP tidak diizinkan merchant.' } });
  req.clientIp=access.ip;
  const signed = verifySignedRequest(req, merchant);
  if (!signed.ok) return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: signed.message } });
  const amount = Number(req.body?.amount || 0);
  if (amount && (amount < (merchant.min_amount || 1000) || amount > (merchant.max_amount || 100000000))) return res.status(422).json({ error: { code: 'AMOUNT_OUT_OF_RANGE', message: 'Nominal berada di luar batas merchant.' } });
  req.merchant = merchant; next();
}
