import db, { id, now } from '../database.js';

const error = (message, status = 422, code = 'FINANCE_ERROR') => Object.assign(new Error(message), { status, code });
const accountCode = (merchantId, suffix) => `${merchantId}:${suffix}`;

export class FinanceService {
  async ensureAccounts(merchantId, conn = db) {
    const accounts = [['cash', 'Gateway clearing', 'ASSET'], ['payable', 'Merchant payable', 'LIABILITY'], ['fees', 'Platform fee revenue', 'REVENUE'], ['refunds', 'Refund clearing', 'ASSET']];
    for (const [suffix, name, type] of accounts) await conn.run('INSERT IGNORE INTO ledger_accounts (id,merchant_id,code,name,type,created_at) VALUES (?,?,?,?,?,?)', [id('acc'), merchantId, accountCode(merchantId, suffix), name, type, now()]);
  }

  async post({ referenceType, referenceId, idempotencyKey, description, entries }, connection = null) {
    const debit = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amount, 0);
    const credit = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0);
    if (debit !== credit || debit <= 0) throw error('Ledger tidak seimbang.', 409, 'UNBALANCED_LEDGER');
    if (connection) return this.#post(connection, { referenceType, referenceId, idempotencyKey, description, entries });
    return db.transaction((tx) => this.#post(tx, { referenceType, referenceId, idempotencyKey, description, entries }));
  }

  async #post(conn, { referenceType, referenceId, idempotencyKey, description, entries }) {
    const existing = await conn.get('SELECT * FROM ledger_transactions WHERE idempotency_key=?', [idempotencyKey]);
    if (existing) return existing;
    const transactionId = id('ltx'); const timestamp = now();
    await conn.run('INSERT INTO ledger_transactions (id,reference_type,reference_id,idempotency_key,description,created_at) VALUES (?,?,?,?,?,?)', [transactionId, referenceType, referenceId, idempotencyKey, description, timestamp]);
    for (const entry of entries) {
      const account = await conn.get('SELECT id FROM ledger_accounts WHERE code=?', [entry.code]);
      if (!account) throw error(`Akun ledger ${entry.code} tidak ditemukan.`, 500);
      await conn.run('INSERT INTO ledger_entries (id,transaction_id,account_id,direction,amount,created_at) VALUES (?,?,?,?,?,?)', [id('len'), transactionId, account.id, entry.direction, entry.amount, timestamp]);
    }
    return conn.get('SELECT * FROM ledger_transactions WHERE id=?', [transactionId]);
  }

  async capturePayment(payment) {
    if (payment.status !== 'PAID') return null;
    return db.transaction(async (tx) => {
      await this.ensureAccounts(payment.merchant_id, tx);
      const net = Math.max(0, payment.net_amount ?? payment.amount); const fee = Math.max(0, payment.total_amount - net);
      const entries = [{ code: accountCode(payment.merchant_id, 'cash'), direction: 'DEBIT', amount: payment.total_amount }, { code: accountCode(payment.merchant_id, 'payable'), direction: 'CREDIT', amount: net }];
      if (fee) entries.push({ code: accountCode(payment.merchant_id, 'fees'), direction: 'CREDIT', amount: fee });
      return this.post({ referenceType: 'payment', referenceId: payment.id, idempotencyKey: `payment:${payment.id}:captured`, description: `Capture ${payment.merchant_order_id}`, entries }, tx);
    });
  }

  async backfill() { const rows = await db.all("SELECT * FROM payments WHERE status='PAID'"); await Promise.all(rows.map((row) => this.capturePayment(row))); return rows.length; }

  async balance(merchantId) {
    await this.ensureAccounts(merchantId);
    const account = await db.get('SELECT id FROM ledger_accounts WHERE code=?', [accountCode(merchantId, 'payable')]);
    const available = (await db.get("SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) value FROM ledger_entries WHERE account_id=?", [account.id])).value;
    const pending = (await db.get("SELECT COALESCE(SUM(net_amount),0) value FROM payments WHERE merchant_id=? AND status='PENDING'", [merchantId])).value;
    const settled = (await db.get("SELECT COALESCE(SUM(amount),0) value FROM settlements WHERE merchant_id=? AND status='SUCCEEDED'", [merchantId])).value;
    return { available, pending, settled };
  }

  async refund(paymentId, { amount, reason, requestedBy, idempotencyKey }) {
    return db.transaction(async (tx) => {
      const payment = await tx.get('SELECT * FROM payments WHERE id=?', [paymentId]);
      if (!payment || payment.status !== 'PAID') throw error('Hanya pembayaran PAID yang dapat direfund.', 409);
      const refunded = (await tx.get("SELECT COALESCE(SUM(amount),0) value FROM refunds WHERE payment_id=? AND status IN ('SUCCEEDED','PROCESSING','MANUAL_REQUIRED')", [paymentId])).value;
      const value = Number(amount || payment.amount - refunded);
      if (!Number.isInteger(value) || value <= 0 || value > payment.amount - refunded) throw error('Nominal refund tidak valid.');
      const existing = idempotencyKey && await tx.get('SELECT * FROM refunds WHERE idempotency_key=?', [idempotencyKey]);
      if (existing) return existing;
      const status = payment.provider === 'simulator' ? 'SUCCEEDED' : 'MANUAL_REQUIRED'; const refundId = id('ref'); const timestamp = now();
      await tx.run('INSERT INTO refunds (id,payment_id,merchant_id,amount,reason,status,requested_by,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?)', [refundId, payment.id, payment.merchant_id, value, reason?.trim() || 'Refund requested', status, requestedBy, timestamp, timestamp, idempotencyKey || `refund:${refundId}`]);
      if (status === 'SUCCEEDED') {
        await this.ensureAccounts(payment.merchant_id, tx);
        await this.post({ referenceType: 'refund', referenceId: refundId, idempotencyKey: `refund:${refundId}:posted`, description: `Refund ${payment.merchant_order_id}`, entries: [{ code: accountCode(payment.merchant_id, 'payable'), direction: 'DEBIT', amount: value }, { code: accountCode(payment.merchant_id, 'refunds'), direction: 'CREDIT', amount: value }] }, tx);
      }
      return tx.get('SELECT * FROM refunds WHERE id=?', [refundId]);
    });
  }

  async requestSettlement(merchantId, { amount, destination, requestedBy }) {
    const value = Number(amount); const balance = await this.balance(merchantId);
    if (!Number.isInteger(value) || value <= 0 || value > balance.available) throw error('Nominal settlement melebihi saldo tersedia.');
    const settlementId = id('set'); const timestamp = now();
    await db.run('INSERT INTO settlements (id,merchant_id,amount,status,destination_json,requested_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [settlementId, merchantId, value, 'APPROVAL_REQUIRED', JSON.stringify(destination || {}), requestedBy, timestamp, timestamp]);
    return db.get('SELECT * FROM settlements WHERE id=?', [settlementId]);
  }

  async approveSettlement(settlementId, approvedBy) {
    return db.transaction(async (tx) => {
      const settlement = await tx.get("SELECT * FROM settlements WHERE id=? AND status='APPROVAL_REQUIRED'", [settlementId]);
      if (!settlement) throw error('Settlement tidak ditemukan atau telah diproses.', 404);
      await this.ensureAccounts(settlement.merchant_id, tx);
      await tx.run('UPDATE settlements SET status=?,approved_by=?,updated_at=? WHERE id=?', ['SUCCEEDED', approvedBy, now(), settlement.id]);
      await this.post({ referenceType: 'settlement', referenceId: settlement.id, idempotencyKey: `settlement:${settlement.id}:posted`, description: 'Merchant settlement', entries: [{ code: accountCode(settlement.merchant_id, 'payable'), direction: 'DEBIT', amount: settlement.amount }, { code: accountCode(settlement.merchant_id, 'cash'), direction: 'CREDIT', amount: settlement.amount }] }, tx);
      return tx.get('SELECT * FROM settlements WHERE id=?', [settlement.id]);
    });
  }
}
