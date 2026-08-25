import crypto from 'node:crypto';
import db, { id, now } from '../database.js';

const error = (message, status = 422, code = 'FINANCE_ERROR') => Object.assign(new Error(message), { status, code });
const accountCode = (merchantId, suffix) => `${merchantId}:${suffix}`;

export class FinanceService {
  async ensureAccounts(merchantId, conn = db) {
    const accounts = [['cash', 'Gateway clearing', 'ASSET'], ['payable', 'Merchant payable', 'LIABILITY'], ['fees', 'Platform fee revenue', 'REVENUE'], ['refunds', 'Refund clearing', 'ASSET'], ['reserve', 'Merchant rolling reserve', 'LIABILITY']];
    for (const [suffix, name, type] of accounts) await conn.run('INSERT IGNORE INTO ledger_accounts (id,merchant_id,code,name,type,created_at) VALUES (?,?,?,?,?,?)', [id('acc'), merchantId, accountCode(merchantId, suffix), name, type, now()]);
  }

  async post({ referenceType, referenceId, idempotencyKey, description, entries }, connection = null) {
    if(!idempotencyKey?.trim()||!referenceType?.trim()||!referenceId?.trim()||!Array.isArray(entries)||entries.length<2||entries.some(entry=>!['DEBIT','CREDIT'].includes(entry.direction)||!Number.isInteger(entry.amount)||entry.amount<=0))throw error('Ledger posting tidak valid.',422,'INVALID_LEDGER_POST');
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
    const entryHash=crypto.createHash('sha256').update(JSON.stringify(entries.map(x=>[x.code,x.direction,x.amount]).sort())).digest('hex');
    await conn.run('INSERT INTO ledger_transactions (id,reference_type,reference_id,idempotency_key,description,entry_hash,posted_at,created_at) VALUES (?,?,?,?,?,?,?,?)', [transactionId, referenceType, referenceId, idempotencyKey, description, entryHash,timestamp,timestamp]);
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

  async backfill() { const rows = await db.all("SELECT * FROM payments WHERE status='PAID'"); for (const row of rows) await this.capturePayment(row); return rows.length; }

  async balance(merchantId) {
    await this.ensureAccounts(merchantId);
    const account = await db.get('SELECT id FROM ledger_accounts WHERE code=?', [accountCode(merchantId, 'payable')]);
    const available = (await db.get("SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) value FROM ledger_entries WHERE account_id=?", [account.id])).value;
    const pending = (await db.get("SELECT COALESCE(SUM(net_amount),0) value FROM payments WHERE merchant_id=? AND status='PENDING'", [merchantId])).value;
    const settled = (await db.get("SELECT COALESCE(SUM(amount),0) value FROM settlements WHERE merchant_id=? AND status='SUCCEEDED'", [merchantId])).value;
    const reserved = (await db.get("SELECT COALESCE(SUM(amount),0) value FROM merchant_reserves WHERE merchant_id=? AND status='ACTIVE'",[merchantId])).value;
    const inApproval=(await db.get("SELECT COALESCE(SUM(amount),0) value FROM settlements WHERE merchant_id=? AND status IN ('APPROVAL_REQUIRED','PROCESSING')",[merchantId])).value;
    return { available:Math.max(0,Number(available)-Number(reserved)-Number(inApproval)), ledger_available:Number(available), pending, settled, reserved:Number(reserved), in_approval:Number(inApproval) };
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

  async report(merchantId, { from, to, status, method } = {}) {
    const where = ['merchant_id=?'], params = [merchantId];
    if (from) { where.push('created_at>=?'); params.push(`${from}T00:00:00.000Z`); }
    if (to) { where.push('created_at<=?'); params.push(`${to}T23:59:59.999Z`); }
    if (status) { where.push('status=?'); params.push(status); }
    if (method) { where.push('payment_method=?'); params.push(method); }
    const filter = where.join(' AND ');
    const [summary, methods, rows, ledger] = await Promise.all([
      db.get(`SELECT COUNT(*) transactions,COALESCE(SUM(CASE WHEN status='PAID' THEN total_amount ELSE 0 END),0) gross,COALESCE(SUM(CASE WHEN status='PAID' THEN net_amount ELSE 0 END),0) net,COALESCE(SUM(CASE WHEN status='PAID' THEN total_amount-net_amount ELSE 0 END),0) fees,SUM(status='PAID') paid,SUM(status IN ('FAILED','EXPIRED')) failed FROM payments WHERE ${filter}`, params),
      db.all(`SELECT payment_method,COUNT(*) transactions,COALESCE(SUM(CASE WHEN status='PAID' THEN total_amount ELSE 0 END),0) gross FROM payments WHERE ${filter} GROUP BY payment_method ORDER BY gross DESC`, params),
      db.all(`SELECT id,merchant_order_id,payment_method,status,total_amount,net_amount,created_at FROM payments WHERE ${filter} ORDER BY created_at DESC LIMIT 1000`, params),
      db.get("SELECT COUNT(*) entries,COALESCE(SUM(CASE WHEN le.direction='CREDIT' THEN le.amount ELSE -le.amount END),0) balance FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.account_id WHERE la.merchant_id=?", [merchantId])
    ]);
    return { summary: { ...summary, success_rate: summary.transactions ? Number(summary.paid) / Number(summary.transactions) * 100 : 0 }, methods, rows, ledger };
  }
  async reconcile(merchantId,actorId,workspaceId=null){const merchant=await db.get('SELECT workspace_id FROM merchants WHERE id=?',[merchantId]);if(!merchant)throw error('Project tidak ditemukan.',404);const runId=id('rec'),t=now();const payments=await db.all("SELECT p.id,p.status,p.total_amount,p.net_amount,lt.id ledger_id FROM payments p LEFT JOIN ledger_transactions lt ON lt.reference_type='payment' AND lt.reference_id=p.id WHERE p.merchant_id=?",[merchantId]),mismatch=[];for(const row of payments){if(row.status==='PAID'&&!row.ledger_id)mismatch.push({row,type:'LEDGER_ENTRY_MISSING'});else if(row.status==='PAID'&&(!row.net_amount||row.net_amount>row.total_amount))mismatch.push({row,type:'INVALID_NET_AMOUNT'});}await db.transaction(async tx=>{await tx.run('INSERT INTO reconciliation_runs (id,provider,merchant_id,workspace_id,triggered_by,status,checked_count,mismatch_count,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[runId,`merchant:${merchantId}`,merchantId,workspaceId||merchant.workspace_id,actorId,'COMPLETED',payments.length,mismatch.length,t,t]);for(const x of mismatch)await tx.run('INSERT INTO reconciliation_items (id,run_id,payment_id,issue_type,local_status,details_json,resolution_status,created_at) VALUES (?,?,?,?,?,?,?,?)',[id('rci'),runId,x.row.id,x.type,x.row.status,JSON.stringify({total_amount:x.row.total_amount,net_amount:x.row.net_amount}),'OPEN',t]);});return{id:runId,checked_count:payments.length,mismatch_count:mismatch.length,status:'COMPLETED'};}
  async discrepancies(merchantId){return db.all('SELECT i.*,r.created_at run_at FROM reconciliation_items i JOIN reconciliation_runs r ON r.id=i.run_id WHERE r.merchant_id=? ORDER BY i.created_at DESC',[merchantId]);}
  async resolveDiscrepancy(itemId,merchantId,{status,notes,assignedTo},actorId){if(!['INVESTIGATING','RESOLVED','IGNORED'].includes(status))throw error('Status discrepancy tidak valid.');const item=await db.get('SELECT i.id FROM reconciliation_items i JOIN reconciliation_runs r ON r.id=i.run_id WHERE i.id=? AND r.merchant_id=?',[itemId,merchantId]);if(!item)throw error('Discrepancy tidak ditemukan.',404);await db.run('UPDATE reconciliation_items SET resolution_status=?,assigned_to=?,resolution_notes=?,resolved_by=?,resolved_at=? WHERE id=?',[status,assignedTo||null,notes||null,['RESOLVED','IGNORED'].includes(status)?actorId:null,['RESOLVED','IGNORED'].includes(status)?now():null,itemId]);return db.get('SELECT * FROM reconciliation_items WHERE id=?',[itemId]);}
  async reserve(merchantId,{amount,reason,releaseAt,createdBy}){const value=Number(amount);if(!Number.isInteger(value)||value<=0||!reason?.trim())throw error('Reserve tidak valid.');const balance=await this.balance(merchantId);if(value>balance.available)throw error('Reserve melebihi saldo tersedia.',409);const rid=id('rsv');await db.run('INSERT INTO merchant_reserves (id,merchant_id,amount,reason,release_at,created_by,created_at) VALUES (?,?,?,?,?,?,?)',[rid,merchantId,value,reason.trim(),releaseAt||null,createdBy,now()]);return db.get('SELECT * FROM merchant_reserves WHERE id=?',[rid]);}
  async ledgerIntegrity(merchantId){const rows=await db.all('SELECT lt.id,lt.entry_hash,le.direction,le.amount,la.code FROM ledger_transactions lt JOIN ledger_entries le ON le.transaction_id=lt.id JOIN ledger_accounts la ON la.id=le.account_id WHERE la.merchant_id=? ORDER BY lt.id,la.code,le.direction,le.amount',[merchantId]),groups=Map.groupBy(rows,x=>x.id),issues=[];for(const [id,entries] of groups){const debit=entries.filter(x=>x.direction==='DEBIT').reduce((n,x)=>n+Number(x.amount),0),credit=entries.filter(x=>x.direction==='CREDIT').reduce((n,x)=>n+Number(x.amount),0),hash=crypto.createHash('sha256').update(JSON.stringify(entries.map(x=>[x.code,x.direction,Number(x.amount)]).sort())).digest('hex');if(debit!==credit||entries[0].entry_hash&&entries[0].entry_hash!==hash)issues.push({transaction_id:id,balanced:debit===credit,hash_valid:entries[0].entry_hash===hash});}return{valid:issues.length===0,checked:groups.size,issues};}
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
      await tx.run('UPDATE settlements SET status=?,approved_by=?,updated_at=? WHERE id=?', ['PROCESSING', approvedBy, now(), settlement.id]);
      // ponytail: provider-confirmed settlement posts ledger later; approval never transfers funds.
      if(false) await this.post({ referenceType: 'settlement', referenceId: settlement.id, idempotencyKey: `settlement:${settlement.id}:posted`, description: 'Merchant settlement', entries: [{ code: accountCode(settlement.merchant_id, 'payable'), direction: 'DEBIT', amount: settlement.amount }, { code: accountCode(settlement.merchant_id, 'cash'), direction: 'CREDIT', amount: settlement.amount }] }, tx);
      return tx.get('SELECT * FROM settlements WHERE id=?', [settlement.id]);
    });
  }
}
