import db, { id, now } from '../database.js';
import { config } from '../config.js';
import { log, metrics } from '../observability.js';

export const reconcileOutcome = (before, after) => before === after ? 'MATCHED' : 'FIXED';
export class ReconciliationService {
  constructor(payments, webhooks) { this.payments = payments; this.webhooks = webhooks; this.running = false; }
  async run(triggerType = 'AUTO') {
    if (this.running) return null;
    const stale = new Date(Date.now() - 600000).toISOString();
    const lock = await db.run("UPDATE reconciliation_locks SET locked_at=? WHERE name='tokopay' AND (locked_at IS NULL OR locked_at<?)", [now(), stale]);
    if (!lock.changes) return null;
    this.running = true;
    const run = { id: id('rec'), trigger: triggerType, started: now(), examined: 0, matched: 0, fixed: 0, errors: 0 };
    try {
      await db.run("INSERT INTO reconciliation_runs (id,trigger_type,status,started_at) VALUES (?,?,'RUNNING',?)", [run.id, run.trigger, run.started]);
      const threshold = new Date(Date.now() - config.reconciliationGraceMs).toISOString();
      const rows = await db.all("SELECT * FROM payments WHERE status='PENDING' AND environment='LIVE' AND created_at<=? ORDER BY created_at ASC LIMIT ?", [threshold, config.reconciliationBatchSize]);
      for (const payment of rows) {
        run.examined++;
        try {
          const updated = await this.payments.sync(payment);
          const outcome = reconcileOutcome(payment.status, updated.status);
          if (outcome === 'FIXED') { run.fixed++; if (updated.status === 'PAID') await this.webhooks.queue(updated); } else run.matched++;
          await db.run('INSERT INTO reconciliation_items (id,run_id,payment_id,before_status,provider_status,after_status,outcome,created_at) VALUES (?,?,?,?,?,?,?,?)', [id('reci'), run.id, payment.id, payment.status, updated.status, updated.status, outcome, now()]);
        } catch (error) {
          run.errors++;
          await db.run('INSERT INTO reconciliation_items (id,run_id,payment_id,before_status,outcome,error,created_at) VALUES (?,?,?,?,?,?,?)', [id('reci'), run.id, payment.id, payment.status, 'ERROR', String(error.message || error).slice(0, 1024), now()]);
        }
      }
      await db.run("UPDATE reconciliation_runs SET status='COMPLETED',examined=?,matched=?,fixed=?,errors=?,finished_at=? WHERE id=?", [run.examined, run.matched, run.fixed, run.errors, now(), run.id]);
      metrics.increment('evopay_reconciliation_runs_total',{outcome:'completed'}); log('info','reconciliation_completed',{run_id:run.id,examined:run.examined,fixed:run.fixed,errors:run.errors}); return { ...run, status: 'COMPLETED' };
    } catch (error) {
      await db.run("UPDATE reconciliation_runs SET status='FAILED',examined=?,matched=?,fixed=?,errors=?,finished_at=? WHERE id=?", [run.examined, run.matched, run.fixed, run.errors + 1, now(), run.id]).catch(() => {});
      metrics.increment('evopay_reconciliation_runs_total',{outcome:'failed'}); log('error','reconciliation_failed',{run_id:run.id,message:error.message}); throw error;
    } finally { this.running = false; await db.run("UPDATE reconciliation_locks SET locked_at=NULL WHERE name='tokopay'").catch(() => {}); }
  }
  async latest() {
    const run = await db.get('SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT 1');
    return { run, items: run ? await db.all('SELECT i.*,p.order_id,s.name site_name FROM reconciliation_items i JOIN payments p ON p.id=i.payment_id JOIN sites s ON s.id=p.site_id WHERE i.run_id=? ORDER BY i.created_at DESC LIMIT 100', [run.id]) : [] };
  }
}
