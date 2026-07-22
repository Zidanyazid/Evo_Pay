import crypto from 'node:crypto';
import db,{id,now} from '../database.js';
const fail=(m,s=422)=>{throw Object.assign(new Error(m),{status:s})};

export class OperationsService{
 constructor(routing,providers){this.routing=routing;this.providers=providers}
 async routes(){return db.all('SELECT * FROM provider_route_configs ORDER BY merchant_id,payment_method,priority DESC')}
 async saveRoute(x){
  if(!x.provider||!this.routing.registry.available().includes(x.provider))fail('Provider tidak valid.');
  const t=now(),rid=x.id||id('prc');
  if(x.id)await db.run('UPDATE provider_route_configs SET merchant_id=?,payment_method=?,provider=?,priority=?,weight=?,min_amount=?,max_amount=?,is_active=?,updated_at=? WHERE id=?',[x.merchant_id||null,x.payment_method||null,x.provider,x.priority??100,x.weight??100,x.min_amount||null,x.max_amount||null,Number(x.is_active!==false),t,x.id]);
  else await db.run('INSERT INTO provider_route_configs (id,merchant_id,payment_method,provider,priority,weight,min_amount,max_amount,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[rid,x.merchant_id||null,x.payment_method||null,x.provider,x.priority??100,x.weight??100,x.min_amount||null,x.max_amount||null,1,t,t]);
  return db.get('SELECT * FROM provider_route_configs WHERE id=?',[rid]);
 }
 async riskRules(){return db.all('SELECT * FROM risk_rules ORDER BY created_at DESC')}
 async createRiskRule(x){
  if(!x.name?.trim()||!['amount','velocity_hour','email_missing'].includes(x.signal)||!['GT','GTE','EQ'].includes(x.operator)||!['ALLOW','REVIEW','BLOCK'].includes(x.action))fail('Risk rule tidak valid.');
  const rid=id('rrl');
  await db.run('INSERT INTO risk_rules (id,name,`signal`,`operator`,threshold,window_seconds,score,action,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[rid,x.name.trim(),x.signal,x.operator,Number(x.threshold),x.window_seconds||null,x.score||0,x.action,now()]);
  return db.get('SELECT * FROM risk_rules WHERE id=?',[rid]);
 }
 async evaluate(merchant,input){
  const cutoff=new Date(Date.now()-60*60*1000).toISOString();
  const velocity=(await db.get('SELECT COUNT(*) count FROM payments WHERE merchant_id=? AND created_at>=?',[merchant.id,cutoff])).count;
  const signals={amount:Number(input.amount)||0,velocity_hour:velocity,email_missing:input.customer?.email?0:1};
  const rules=(await this.riskRules()).filter(x=>x.is_active);
  const matches=rules.filter(r=>r.operator==='GT'?signals[r.signal]>r.threshold:r.operator==='GTE'?signals[r.signal]>=r.threshold:signals[r.signal]===r.threshold);
  const score=matches.reduce((a,x)=>a+x.score,0),decision=matches.some(x=>x.action==='BLOCK')?'BLOCK':matches.some(x=>x.action==='REVIEW')?'REVIEW':'ALLOW',eventId=id('rsk');
  await db.run('INSERT INTO risk_events (id,merchant_id,score,decision,signals_json,review_status,created_at) VALUES (?,?,?,?,?,?,?)',[eventId,merchant.id,score,decision,JSON.stringify({signals,matches:matches.map(x=>x.id)}),decision==='REVIEW'?'PENDING':null,now()]);
  return{id:eventId,score,decision,signals};
 }
 async reviewRisk(eventId,decision,userId){
  if(!['APPROVED','REJECTED'].includes(decision))fail('Keputusan review tidak valid.');
  const result=await db.run('UPDATE risk_events SET review_status=?,reviewed_by=? WHERE id=?',[decision,userId,eventId]);
  if(!result.changes)fail('Risk event tidak ditemukan.',404);
  return db.get('SELECT * FROM risk_events WHERE id=?',[eventId]);
 }
 async disputes(){return db.all('SELECT d.*,p.merchant_order_id,p.amount,m.name merchant_name FROM disputes d JOIN payments p ON p.id=d.payment_id JOIN merchants m ON m.id=p.merchant_id ORDER BY d.updated_at DESC')}
 async createDispute(x,userId){
  const p=await db.get("SELECT id FROM payments WHERE id=? AND status='PAID'",[x.payment_id]);
  if(!p)fail('Pembayaran PAID tidak ditemukan.',404);
  const t=now(),did=id('dsp');
  await db.transaction(async tx=>{
   await tx.run("INSERT INTO disputes (id,payment_id,status,reason,notes,created_at,updated_at) VALUES (?,?,'OPEN',?,?,?,?)",[did,x.payment_id,x.reason||'Customer claim',x.notes||null,t,t]);
   await tx.run("INSERT INTO dispute_events (id,dispute_id,to_status,notes,actor_id,created_at) VALUES (?,?,'OPEN',?,?,?)",[id('dse'),did,x.notes||null,userId,t]);
  });
  return db.get('SELECT * FROM disputes WHERE id=?',[did]);
 }
 async transitionDispute(did,status,notes,userId){
  const d=await db.get('SELECT * FROM disputes WHERE id=?',[did]),allowed={OPEN:['INVESTIGATING','WON','LOST'],INVESTIGATING:['EVIDENCE_SUBMITTED','WON','LOST'],EVIDENCE_SUBMITTED:['WON','LOST']};
  if(!d)fail('Dispute tidak ditemukan.',404);
  if(!allowed[d.status]?.includes(status))fail('Transisi dispute tidak valid.',409);
  const t=now();
  await db.transaction(async tx=>{
   await tx.run('UPDATE disputes SET status=?,notes=?,updated_at=? WHERE id=?',[status,notes||d.notes,t,did]);
   await tx.run('INSERT INTO dispute_events (id,dispute_id,from_status,to_status,notes,actor_id,created_at) VALUES (?,?,?,?,?,?,?)',[id('dse'),did,d.status,status,notes||null,userId,t]);
  });
  return db.get('SELECT * FROM disputes WHERE id=?',[did]);
 }
 async addEvidence(did,x,userId){
  if(!await db.get('SELECT id FROM disputes WHERE id=?',[did]))fail('Dispute tidak ditemukan.',404);
  const eid=id('dev'),content=x.content||'',checksum=crypto.createHash('sha256').update(content).digest('hex');
  await db.run('INSERT INTO dispute_evidence (id,dispute_id,type,file_name,storage_key,content,checksum,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[eid,did,x.type||'NOTE',x.file_name||null,x.storage_key||null,content,checksum,userId,now()]);
  return db.get('SELECT * FROM dispute_evidence WHERE id=?',[eid]);
 }
 async incidents(){
  const incidents=await db.all('SELECT * FROM provider_incidents ORDER BY started_at DESC');
  return Promise.all(incidents.map(async x=>({...x,updates:await db.all('SELECT * FROM incident_updates WHERE incident_id=? ORDER BY created_at',[x.id])})));
 }
 async createIncident(x,userId){
  if(!x.provider||!x.title?.trim()||!['MINOR','MAJOR','CRITICAL'].includes(x.severity))fail('Incident tidak valid.');
  const t=now(),iid=id('inc');
  await db.transaction(async tx=>{
   await tx.run("INSERT INTO provider_incidents (id,provider,title,status,severity,message,started_at,created_at) VALUES (?,?,?,'INVESTIGATING',?,?,?,?)",[iid,x.provider,x.title.trim(),x.severity,x.message||null,t,t]);
   await tx.run("INSERT INTO incident_updates (id,incident_id,status,message,created_by,created_at) VALUES (?,?,'INVESTIGATING',?,?,?)",[id('inu'),iid,x.message||'Investigasi dimulai.',userId,t]);
  });
  return db.get('SELECT * FROM provider_incidents WHERE id=?',[iid]);
 }
 async updateIncident(iid,x,userId){
  if(!['INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED'].includes(x.status))fail('Status incident tidak valid.');
  const t=now(),result=await db.run('UPDATE provider_incidents SET status=?,message=?,resolved_at=? WHERE id=?',[x.status,x.message||null,x.status==='RESOLVED'?t:null,iid]);
  if(!result.changes)fail('Incident tidak ditemukan.',404);
  await db.run('INSERT INTO incident_updates (id,incident_id,status,message,created_by,created_at) VALUES (?,?,?,?,?,?)',[id('inu'),iid,x.status,x.message||x.status,userId,t]);
  return db.get('SELECT * FROM provider_incidents WHERE id=?',[iid]);
 }
 async health(){
  const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
  const [jobs,payments,providers,openIncidents]=await Promise.all([
   db.all('SELECT status,COUNT(*) count FROM system_jobs GROUP BY status'),
   db.all('SELECT status,COUNT(*) count FROM payments WHERE created_at>=? GROUP BY status',[cutoff]),
   this.providers.summary(),
   db.get("SELECT COUNT(*) count FROM provider_incidents WHERE status!='RESOLVED'")
  ]);
  const degraded=providers.some(x=>!x.configured||x.circuit==='OPEN'||(x.success_rate!=null&&x.success_rate<80));
  return{status:degraded?'DEGRADED':'OPERATIONAL',providers,jobs,payments,open_incidents:openIncidents.count,generated_at:now()};
 }
}
