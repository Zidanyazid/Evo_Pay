import db, { id, now } from '../database.js';

const error = (message, status = 422, code = 'FINANCE_ERROR') => Object.assign(new Error(message), { status, code });
const accountCode = (merchantId, suffix) => `${merchantId}:${suffix}`;

export class FinanceService {
  ensureAccounts(merchantId) {
    const accounts = [['cash', 'Gateway clearing', 'ASSET'], ['payable', 'Merchant payable', 'LIABILITY'], ['fees', 'Platform fee revenue', 'REVENUE'], ['refunds', 'Refund clearing', 'ASSET']];
    const insert = db.prepare('INSERT OR IGNORE INTO ledger_accounts (id,merchant_id,code,name,type,created_at) VALUES (?,?,?,?,?,?)');
    for (const [suffix, name, type] of accounts) insert.run(id('acc'), merchantId, accountCode(merchantId, suffix), name, type, now());
  }

  post({ referenceType, referenceId, idempotencyKey, description, entries }) {
    const debit = entries.filter((x) => x.direction === 'DEBIT').reduce((sum, x) => sum + x.amount, 0);
    const credit = entries.filter((x) => x.direction === 'CREDIT').reduce((sum, x) => sum + x.amount, 0);
    if (debit !== credit || debit <= 0) throw error('Ledger tidak seimbang.', 409, 'UNBALANCED_LEDGER');
    const existing = db.prepare('SELECT * FROM ledger_transactions WHERE idempotency_key=?').get(idempotencyKey);
    if (existing) return existing;
    return db.transaction(() => {
      const transactionId = id('ltx'); const timestamp = now();
      db.prepare('INSERT INTO ledger_transactions (id,reference_type,reference_id,idempotency_key,description,created_at) VALUES (?,?,?,?,?,?)').run(transactionId, referenceType, referenceId, idempotencyKey, description, timestamp);
      const insert = db.prepare('INSERT INTO ledger_entries (id,transaction_id,account_id,direction,amount,created_at) VALUES (?,?,?,?,?,?)');
      for (const entry of entries) {
        const account = db.prepare('SELECT id FROM ledger_accounts WHERE code=?').get(entry.code);
        if (!account) throw error(`Akun ledger ${entry.code} tidak ditemukan.`, 500);
        insert.run(id('len'), transactionId, account.id, entry.direction, entry.amount, timestamp);
      }
      return db.prepare('SELECT * FROM ledger_transactions WHERE id=?').get(transactionId);
    })();
  }

  capturePayment(payment) {
    if (payment.status !== 'PAID') return null;
    this.ensureAccounts(payment.merchant_id);
    const net = Math.max(0, payment.net_amount ?? payment.amount); const fee = Math.max(0, payment.total_amount - net);
    const entries = [{ code: accountCode(payment.merchant_id, 'cash'), direction: 'DEBIT', amount: payment.total_amount }, { code: accountCode(payment.merchant_id, 'payable'), direction: 'CREDIT', amount: net }];
    if (fee) entries.push({ code: accountCode(payment.merchant_id, 'fees'), direction: 'CREDIT', amount: fee });
    return this.post({ referenceType: 'payment', referenceId: payment.id, idempotencyKey: `payment:${payment.id}:captured`, description: `Capture ${payment.merchant_order_id}`, entries });
  }

  backfill() { const rows = db.prepare("SELECT * FROM payments WHERE status='PAID'").all(); for (const row of rows) this.capturePayment(row); return rows.length; }

  balance(merchantId) {
    this.ensureAccounts(merchantId);
    const account = db.prepare('SELECT id FROM ledger_accounts WHERE code=?').get(accountCode(merchantId, 'payable'));
    const available = db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) value FROM ledger_entries WHERE account_id=?").get(account.id).value;
    const pending = db.prepare("SELECT COALESCE(SUM(net_amount),0) value FROM payments WHERE merchant_id=? AND status='PENDING'").get(merchantId).value;
    const settled = db.prepare("SELECT COALESCE(SUM(amount),0) value FROM settlements WHERE merchant_id=? AND status='SUCCEEDED'").get(merchantId).value;
    return { available, pending, settled };
  }

  refund(paymentId, { amount, reason, requestedBy, idempotencyKey }) {
    const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!payment || payment.status !== 'PAID') throw error('Hanya pembayaran PAID yang dapat direfund.', 409);
    const refunded = db.prepare("SELECT COALESCE(SUM(amount),0) value FROM refunds WHERE payment_id=? AND status IN ('SUCCEEDED','PROCESSING','MANUAL_REQUIRED')").get(paymentId).value;
    const value = Number(amount || payment.amount - refunded);
    if (!Number.isInteger(value) || value <= 0 || value > payment.amount - refunded) throw error('Nominal refund tidak valid.');
    const existing = idempotencyKey && db.prepare('SELECT * FROM refunds WHERE idempotency_key=?').get(idempotencyKey);
    if (existing) return existing;
    const status = payment.provider === 'simulator' ? 'SUCCEEDED' : 'MANUAL_REQUIRED'; const refundId = id('ref'); const timestamp = now();
    db.transaction(() => {
      db.prepare('INSERT INTO refunds (id,payment_id,merchant_id,amount,reason,status,requested_by,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?)').run(refundId,payment.id,payment.merchant_id,value,reason?.trim() || 'Refund requested',status,requestedBy,timestamp,timestamp,idempotencyKey || `refund:${refundId}`);
      if (status === 'SUCCEEDED') { this.ensureAccounts(payment.merchant_id); this.post({ referenceType:'refund', referenceId:refundId, idempotencyKey:`refund:${refundId}:posted`, description:`Refund ${payment.merchant_order_id}`, entries:[{ code:accountCode(payment.merchant_id,'payable'), direction:'DEBIT', amount:value },{ code:accountCode(payment.merchant_id,'refunds'), direction:'CREDIT', amount:value }] }); }
    })();
    return db.prepare('SELECT * FROM refunds WHERE id=?').get(refundId);
  }

  requestSettlement(merchantId, { amount, destination, requestedBy }) {
    const value = Number(amount); const balance = this.balance(merchantId);
    if (!Number.isInteger(value) || value <= 0 || value > balance.available) throw error('Nominal settlement melebihi saldo tersedia.');
    const settlementId=id('set'); const timestamp=now();
    db.prepare('INSERT INTO settlements (id,merchant_id,amount,status,destination_json,requested_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(settlementId,merchantId,value,'APPROVAL_REQUIRED',JSON.stringify(destination || {}),requestedBy,timestamp,timestamp);
    return db.prepare('SELECT * FROM settlements WHERE id=?').get(settlementId);
  }

  approveSettlement(settlementId, approvedBy) {
    const settlement=db.prepare("SELECT * FROM settlements WHERE id=? AND status='APPROVAL_REQUIRED'").get(settlementId);
    if (!settlement) throw error('Settlement tidak ditemukan atau telah diproses.',404);
    this.ensureAccounts(settlement.merchant_id);
    db.transaction(() => { db.prepare('UPDATE settlements SET status=?,approved_by=?,updated_at=? WHERE id=?').run('SUCCEEDED',approvedBy,now(),settlement.id); this.post({ referenceType:'settlement',referenceId:settlement.id,idempotencyKey:`settlement:${settlement.id}:posted`,description:'Merchant settlement',entries:[{code:accountCode(settlement.merchant_id,'payable'),direction:'DEBIT',amount:settlement.amount},{code:accountCode(settlement.merchant_id,'cash'),direction:'CREDIT',amount:settlement.amount}] }); })();
    return db.prepare('SELECT * FROM settlements WHERE id=?').get(settlement.id);
  }
}
