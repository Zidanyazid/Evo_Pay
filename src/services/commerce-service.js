import crypto from 'node:crypto';
import db, { id, now } from '../database.js';

const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export class CommerceService {
  async customers(merchantId) {
    return db.all(`SELECT c.*,COUNT(p.id) payment_count,COALESCE(SUM(CASE WHEN p.status='PAID' THEN p.total_amount ELSE 0 END),0) lifetime_value,MAX(p.created_at) last_payment_at FROM customers c LEFT JOIN payments p ON p.merchant_id=c.merchant_id AND (p.customer_email=c.email OR p.customer_phone=c.phone) WHERE c.merchant_id=? GROUP BY c.id ORDER BY c.updated_at DESC`, [merchantId]);
  }

  async saveCustomer(merchantId, input) {
    if (!input.name?.trim() && !input.email?.trim() && !input.phone?.trim()) fail('Identitas customer wajib diisi.');
    const timestamp = now(); const customerId = input.id || id('cus');
    if (input.id) {
      const found = await db.get('SELECT id FROM customers WHERE id=? AND merchant_id=?', [input.id, merchantId]);
      if (!found) fail('Customer tidak ditemukan.', 404);
      await db.run('UPDATE customers SET name=?,email=?,phone=?,notes=?,metadata_json=?,updated_at=? WHERE id=?', [input.name || null, input.email || null, input.phone || null, input.notes || null, JSON.stringify(input.metadata || {}), timestamp, input.id]);
    } else {
      await db.run('INSERT INTO customers (id,merchant_id,name,email,phone,notes,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [customerId, merchantId, input.name || null, input.email || null, input.phone || null, input.notes || null, JSON.stringify(input.metadata || {}), timestamp, timestamp]);
    }
    return db.get('SELECT * FROM customers WHERE id=?', [customerId]);
  }

  async invoices(merchantId) {
    return db.all('SELECT i.*,c.name customer_name,c.email customer_email FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.merchant_id=? ORDER BY i.created_at DESC', [merchantId]);
  }

  async invoice(invoiceId) {
    const invoice = await db.get('SELECT i.*,c.name customer_name,c.email customer_email,m.name merchant_name,m.brand_json FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id JOIN merchants m ON m.id=i.merchant_id WHERE i.id=?', [invoiceId]);
    return invoice ? { ...invoice, items: await db.all('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY position', [invoiceId]) } : null;
  }

  async createInvoice(merchantId, input) {
    if (!Array.isArray(input.items) || !input.items.length) fail('Invoice minimal memiliki satu item.');
    const items = input.items.map((item, position) => {
      const quantity = Math.max(1, Number(item.quantity) || 1); const unitPrice = Number(item.unit_price);
      if (!item.name?.trim() || !Number.isInteger(unitPrice) || unitPrice < 0) fail('Item invoice tidak valid.');
      return { id: id('itm'), name: item.name.trim(), description: item.description || null, quantity, unitPrice, amount: quantity * unitPrice, position };
    });
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0); const tax = Math.round(subtotal * (Number(input.tax_percent) || 0) / 100);
    const discount = Math.min(subtotal + tax, Number(input.discount_amount) || 0); const total = subtotal + tax - discount;
    const timestamp = now(); const invoiceId = id('inv'); const number = input.number || `INV-${Date.now()}`;
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO invoices (id,merchant_id,customer_id,number,status,subtotal,tax_amount,discount_amount,total_amount,due_at,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [invoiceId, merchantId, input.customer_id || null, number, 'DRAFT', subtotal, tax, discount, total, input.due_at || null, input.description || null, timestamp, timestamp]);
      for (const item of items) await tx.run('INSERT INTO invoice_items (id,invoice_id,name,description,quantity,unit_price,amount,position) VALUES (?,?,?,?,?,?,?,?)', [item.id, invoiceId, item.name, item.description, item.quantity, item.unitPrice, item.amount, item.position]);
    });
    return this.invoice(invoiceId);
  }

  async sendInvoice(invoiceId, jobs) {
    const invoice = await this.invoice(invoiceId);
    if (!invoice) fail('Invoice tidak ditemukan.', 404);
    if (!['DRAFT', 'OVERDUE'].includes(invoice.status)) fail('Invoice tidak dapat dikirim pada status ini.', 409);
    const token = crypto.randomBytes(24).toString('base64url'); const timestamp = now();
    await db.run("UPDATE invoices SET status='SENT',portal_token_hash=?,sent_at=?,updated_at=? WHERE id=?", [hash(token), timestamp, timestamp, invoiceId]);
    if (invoice.due_at) jobs.enqueue('invoice.reminder', { invoiceId }, invoice.due_at);
    return { ...await this.invoice(invoiceId), portal_token: token };
  }

  async portalInvoice(token) {
    const invoice = await db.get('SELECT id FROM invoices WHERE portal_token_hash=?', [hash(token)]);
    if (!invoice) return null;
    await db.run("UPDATE invoices SET viewed_at=COALESCE(viewed_at,?),status=CASE WHEN status='SENT' THEN 'VIEWED' ELSE status END,updated_at=? WHERE id=?", [now(), now(), invoice.id]);
    return this.invoice(invoice.id);
  }

  async promotions(merchantId) {
    return db.all('SELECT * FROM promotions WHERE merchant_id=? OR merchant_id IS NULL ORDER BY created_at DESC', [merchantId]);
  }

  async createPromotion(merchantId, input) {
    if (!input.code?.trim() || !['FIXED', 'PERCENT'].includes(input.type) || !Number.isInteger(input.value) || input.value <= 0) fail('Data promo tidak valid.');
    const timestamp = now(); const promoId = id('pro');
    await db.run('INSERT INTO promotions (id,merchant_id,code,type,value,min_amount,max_discount,usage_limit,payment_method,starts_at,ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [promoId, merchantId, input.code.trim().toUpperCase(), input.type, input.value, input.min_amount || 0, input.max_discount || null, input.usage_limit || null, input.payment_method || null, input.starts_at || null, input.ends_at || null, timestamp, timestamp]);
    return db.get('SELECT * FROM promotions WHERE id=?', [promoId]);
  }

  async previewPromotion(merchantId, { code, amount, payment_method: paymentMethod }) {
    const promotion = await db.get('SELECT * FROM promotions WHERE code=? AND (merchant_id=? OR merchant_id IS NULL) AND is_active=1 ORDER BY merchant_id DESC LIMIT 1', [String(code || '').toUpperCase(), merchantId]);
    if (!promotion || amount < promotion.min_amount || (promotion.usage_limit && promotion.usage_count >= promotion.usage_limit) || (promotion.starts_at && promotion.starts_at > now()) || (promotion.ends_at && promotion.ends_at < now()) || (promotion.payment_method && promotion.payment_method !== paymentMethod)) fail('Promo tidak tersedia.', 404);
    let discount = promotion.type === 'PERCENT' ? Math.round(amount * promotion.value / 100) : promotion.value;
    if (promotion.max_discount) discount = Math.min(discount, promotion.max_discount);
    discount = Math.min(discount, amount);
    return { promotion_id: promotion.id, discount, total: amount - discount };
  }

  async branding(merchantId, input) {
    if (input) await db.run('UPDATE merchants SET brand_json=? WHERE id=?', [JSON.stringify(input), merchantId]);
    const row = await db.get('SELECT brand_json FROM merchants WHERE id=?', [merchantId]);
    return row?.brand_json ? JSON.parse(row.brand_json) : {};
  }
}
