import crypto from 'node:crypto';import db,{id,now} from '../database.js';import { validateOutboundUrl } from './outbound-url-policy.js';const fail=(m,s=422)=>{throw Object.assign(new Error(m),{status:s})};const scenarios={pending:['payment.created'],paid:['payment.created','payment.paid'],failed:['payment.created','payment.failed'],expired:['payment.created','payment.expired'],timeout:['provider.timeout']};
export class DeveloperService{
 scenarios(){return Object.entries(scenarios).map(([id,events])=>({id,events,description:`Simulasikan alur ${id}`}))}
 async sessions(mid){const sessions=await db.all('SELECT * FROM sandbox_sessions WHERE merchant_id=? ORDER BY created_at DESC',[mid]);return Promise.all(sessions.map(async x=>({...x,events:(await db.all('SELECT * FROM sandbox_events WHERE session_id=? ORDER BY sequence',[x.id])).map(e=>({...e,payload:JSON.parse(e.payload_json)}))})))}
 async createSession(mid,x,uid){if(!x.name?.trim()||!scenarios[x.scenario])fail('Nama atau scenario sandbox tidak valid.');const t=now(),sid=id('sbx'),expires=new Date(Date.now()+24*3600000).toISOString();await db.run('INSERT INTO sandbox_sessions (id,merchant_id,name,scenario,created_by,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[sid,mid,x.name.trim(),x.scenario,uid,expires,t,t]);return this.runScenario(sid,x.input||{})}
 async runScenario(sid,input={}){const s=await db.get('SELECT * FROM sandbox_sessions WHERE id=?',[sid]);if(!s||s.status!=='ACTIVE'||s.expires_at<now())fail('Sandbox session tidak tersedia.',404);await db.transaction(async tx=>{for(const [i,type] of scenarios[s.scenario].entries())await tx.run('INSERT IGNORE INTO sandbox_events (id,session_id,event_type,payload_json,sequence,created_at) VALUES (?,?,?,?,?,?)',[id('sbe'),sid,type,JSON.stringify({sandbox:true,session_id:sid,scenario:s.scenario,order_id:input.order_id||`SBX-${Date.now()}`,amount:input.amount||10000,status:type.split('.')[1]?.toUpperCase()}),i+1,now()]);await tx.run('UPDATE sandbox_sessions SET updated_at=? WHERE id=?',[now(),sid])});return (await this.sessions(s.merchant_id)).find(x=>x.id===sid)}
 async playground(mid,x,uid){if(!x.url?.trim()||!x.event_type?.trim())fail('URL dan event type wajib diisi.');const url=validateOutboundUrl(x.url);const payload=x.payload||{event:x.event_type,data:{id:'pay_sandbox',status:'PAID'}},body=JSON.stringify(payload),secret=x.secret||'sandbox_secret',headers={'content-type':'application/json','x-evopay-event':x.event_type,'x-evopay-signature':`sha256=${crypto.createHmac('sha256',secret).update(body).digest('hex')}`},eid=id('wpe');await db.run(`INSERT INTO webhook_playground_events (id,merchant_id,event_type,url,payload_json,headers_json,status,created_by,created_at) VALUES (?,?,?,?,?,?,'CAPTURED',?,?)`,[eid,mid,x.event_type,url.toString(),body,JSON.stringify(headers),uid,now()]);return{...await db.get('SELECT * FROM webhook_playground_events WHERE id=?',[eid]),headers,payload}}
 async events({merchantId,type,limit=100}){const params=[merchantId||null,merchantId||null,type||null,type||null,limit],[payments,sandbox]=await Promise.all([db.all(`SELECT e.id,e.event_type type,e.payload_json payload,e.created_at,'payment' source FROM payment_events e LEFT JOIN payments p ON p.id=e.payment_id WHERE (? IS NULL OR p.merchant_id=?) AND (? IS NULL OR e.event_type=?) ORDER BY e.created_at DESC LIMIT ?`,params),db.all(`SELECT e.id,e.event_type type,e.payload_json payload,e.created_at,'sandbox' source FROM sandbox_events e JOIN sandbox_sessions s ON s.id=e.session_id WHERE (? IS NULL OR s.merchant_id=?) AND (? IS NULL OR e.event_type=?) ORDER BY e.created_at DESC LIMIT ?`,params)]);return [...payments,...sandbox].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,limit).map(x=>({...x,payload:JSON.parse(x.payload)}))}
 snippets({language='curl',baseUrl='http://localhost:3000',apiKey='np_sandbox_YOUR_KEY',orderId='ORDER-1001',amount=10000}){const payload={order_id:orderId,payment_method:'QRIS',amount,customer:{name:'Sandbox Customer',email:'customer@example.com'}};const body=JSON.stringify(payload,null,2),url=`${baseUrl}/api/v1/payments`,map={curl:`curl -X POST '${url}' \
  -H 'Authorization: Bearer ${apiKey}' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: ${orderId}' \
  -d '${JSON.stringify(payload)}'`,javascript:`const response = await fetch('${url}', {
  method: 'POST',
  headers: { Authorization: 'Bearer ${apiKey}', 'Content-Type': 'application/json', 'Idempotency-Key': '${orderId}' },
  body: JSON.stringify(${body})
});
const payment = await response.json();`,python:`import requests
response = requests.post('${url}', headers={'Authorization': 'Bearer ${apiKey}', 'Idempotency-Key': '${orderId}'}, json=${JSON.stringify(payload)})
print(response.json())`,php:`<?php
$ch = curl_init('${url}');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ${apiKey}', 'Content-Type: application/json', 'Idempotency-Key: ${orderId}']);
curl_setopt($ch, CURLOPT_POSTFIELDS, '${JSON.stringify(payload)}');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
echo curl_exec($ch);`};if(!map[language])fail('Bahasa snippet tidak didukung.');return{language,code:map[language]}}
}
