import db, { id, now } from '../database.js';

const removableTables = [
  'merchant_payment_methods','merchant_ip_allowlist','api_nonces','usage_counters','routing_rules','fee_rules',
  'merchant_memberships','api_credentials','payment_links','onboarding_applications',
  'merchant_subscriptions','customers','promotions','recurring_plans','saved_reports',
  'provider_route_configs','sandbox_sessions','webhook_playground_events','compliance_assessments'
];
const historyTables = ['payments','refunds','settlements','risk_events','ledger_accounts'];
const failure=(message,code,status)=>Object.assign(new Error(message),{code,status});

export async function deleteMerchant({ merchantId,confirmationName,actorId=null,ip=null,userAgent=null }) {
  const merchant=await db.get('SELECT * FROM merchants WHERE id=?', [merchantId]);
  if(!merchant) throw failure('Merchant tidak ditemukan.','MERCHANT_NOT_FOUND',404);
  if(confirmationName!==merchant.name) throw failure('Nama konfirmasi tidak cocok.','MERCHANT_CONFIRMATION_MISMATCH',422);
  const history=Object.fromEntries(historyTables.map((table)=>[table,db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE merchant_id=?`).get(merchantId).count]));
  if(Object.values(history).some(Boolean)) throw failure('Merchant memiliki histori transaksi atau keuangan. Nonaktifkan merchant untuk mempertahankan jejak audit.','MERCHANT_HAS_HISTORY',409);
  await db.transaction(async (tx) => {
    for(const table of removableTables) await tx.run(`DELETE FROM ${table} WHERE merchant_id=?`, [merchantId]);
    await tx.run('DELETE FROM merchants WHERE id=?', [merchantId]);
    db.prepare('INSERT INTO audit_logs (id,actor_id,action,target_type,target_id,ip,user_agent,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id('aud'),actorId,'MERCHANT_DELETED','merchant',merchant.id,ip,userAgent,JSON.stringify({name:merchant.name}),now());
  });
  return { deleted:true,merchant_id:merchant.id,name:merchant.name };
}
