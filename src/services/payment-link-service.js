import crypto from 'node:crypto';
import db, { id, now } from '../database.js';

const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
const view = (row) => ({ ...row, allow_custom_amount: Boolean(row.allow_custom_amount), metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {}, url: `/l/${row.slug}` });

export class PaymentLinkService {
  async list(merchantId) {
    return (await db.all('SELECT * FROM payment_links WHERE merchant_id=? ORDER BY created_at DESC', [merchantId])).map(view);
  }

  async get(idOrSlug) {
    const row = await db.get('SELECT l.*,m.name merchant_name,m.brand_json FROM payment_links l JOIN merchants m ON m.id=l.merchant_id WHERE l.id=? OR l.slug=?', [idOrSlug, idOrSlug]);
    return row ? view(row) : null;
  }

  async create(merchantId, input) {
    if (!input.title?.trim()) fail('Judul payment link wajib diisi.');
    if (!input.allow_custom_amount && (!Number.isInteger(input.amount) || input.amount < 1000)) fail('Nominal minimal Rp1.000.');
    const timestamp = now();
    const item = { id: id('lnk'), merchant_id: merchantId, slug: input.slug?.trim() || crypto.randomBytes(6).toString('base64url').toLowerCase(), title: input.title.trim(), description: input.description?.trim() || null, amount: input.amount || null, allow_custom_amount: Number(Boolean(input.allow_custom_amount)), min_amount: input.min_amount || 1000, max_amount: input.max_amount || 100000000, usage_limit: input.usage_limit || null, status: 'ACTIVE', expires_at: input.expires_at || null, redirect_url: input.redirect_url || null, metadata_json: JSON.stringify(input.metadata || {}), created_at: timestamp, updated_at: timestamp };
    try {
      await db.run('INSERT INTO payment_links (id,merchant_id,slug,title,description,amount,allow_custom_amount,min_amount,max_amount,usage_limit,status,expires_at,redirect_url,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', Object.values(item));
    } catch (error) {
      if (error.code?.includes('UNIQUE')) fail('Slug sudah digunakan.', 409);
      throw error;
    }
    return this.get(item.id);
  }

  async update(linkId, input) {
    const current = await this.get(linkId);
    if (!current) fail('Payment link tidak ditemukan.', 404);
    const allowed = new Set(['title', 'description', 'amount', 'min_amount', 'max_amount', 'usage_limit', 'status', 'expires_at', 'redirect_url']);
    const values = []; const parts = [];
    for (const [key, value] of Object.entries(input)) if (allowed.has(key)) { parts.push(`${key}=?`); values.push(value); }
    if (parts.length) await db.run(`UPDATE payment_links SET ${parts.join(',')},updated_at=? WHERE id=?`, [...values, now(), linkId]);
    return this.get(linkId);
  }

  async checkout(slug, input, payments) {
    const link = await this.get(slug);
    if (!link || link.status !== 'ACTIVE') fail('Payment link tidak tersedia.', 404);
    if (link.expires_at && link.expires_at < now()) fail('Payment link sudah kedaluwarsa.', 410);
    if (link.usage_limit && link.usage_count >= link.usage_limit) fail('Batas penggunaan payment link tercapai.', 410);
    const amount = link.allow_custom_amount ? Number(input.amount) : link.amount;
    if (!Number.isInteger(amount) || amount < link.min_amount || amount > link.max_amount) fail('Nominal pembayaran di luar batas.');
    const merchant = await db.get('SELECT * FROM merchants WHERE id=? AND is_active=1', [link.merchant_id]);
    if (!merchant) fail('Merchant tidak aktif.', 409);
    const result = await payments.create(merchant, { order_id: `LINK-${link.id}-${Date.now()}`, payment_method: input.payment_method || 'QRIS', amount, description: link.title, customer: input.customer || {}, redirect_url: link.redirect_url });
    await db.run('UPDATE payment_links SET usage_count=usage_count+1,updated_at=? WHERE id=?', [now(), link.id]);
    return result.payment;
  }
}
