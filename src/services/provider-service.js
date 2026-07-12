import db,{id,now} from '../database.js';
export class ProviderService{
 constructor(registry){this.registry=registry}
 record(provider,success,latency,errorClass=null){db.prepare('INSERT INTO provider_metrics(id,provider,success,latency_ms,error_class,created_at) VALUES(?,?,?,?,?,?)').run(id('met'),provider,success?1:0,Math.round(latency),errorClass,now())}
 async probe(name){const provider=this.registry.get(name);const started=Date.now();let success=false,error=null;try{if(!provider.configured())throw new Error('NOT_CONFIGURED');success=true}catch(e){error=e.message}this.record(name,success,Date.now()-started,error);db.prepare('UPDATE providers SET health_status=?,last_checked_at=? WHERE id=?').run(success?'HEALTHY':'DOWN',now(),name);return {name,success,error}}
 summary(){return this.registry.health().map(item=>{const metrics=db.prepare("SELECT COUNT(*) total,SUM(success) successes,AVG(latency_ms) latency FROM provider_metrics WHERE provider=? AND created_at>=datetime('now','-1 hour')").get(item.name);return {...item,success_rate:metrics.total?Math.round(metrics.successes/metrics.total*10000)/100:null,latency_ms:metrics.latency?Math.round(metrics.latency):null}})}
}
