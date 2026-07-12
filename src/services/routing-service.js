import db from '../database.js';
export class RoutingService {
  constructor(registry) { this.registry = registry; }
  candidates(merchantId, method, amount=0) {
    const configs=db.prepare(`SELECT provider,priority,weight FROM provider_route_configs WHERE is_active=1 AND (merchant_id=? OR merchant_id IS NULL) AND (payment_method=? OR payment_method IS NULL) AND (min_amount IS NULL OR min_amount<=?) AND (max_amount IS NULL OR max_amount>=?) ORDER BY CASE WHEN merchant_id IS NULL THEN 1 ELSE 0 END,priority DESC,weight DESC`).all(merchantId,method,amount,amount);
    const rules=db.prepare(`SELECT provider,priority FROM routing_rules WHERE is_active=1 AND (merchant_id=? OR merchant_id IS NULL) AND (payment_method=? OR payment_method IS NULL) ORDER BY CASE WHEN merchant_id IS NULL THEN 1 ELSE 0 END,priority DESC`).all(merchantId,method);
    const ordered=[...configs.map(x=>x.provider),...rules.map(x=>x.provider),...this.registry.available()];
    return [...new Set(ordered)].filter(name=>{const p=this.registry.get(name);const caps=p.capabilities?.();return !caps?.methods||caps.methods.includes(method)});
  }
  select(merchantId, method, amount=0, excluded=[]) {
    const scored=this.candidates(merchantId,method,amount).filter(name=>!excluded.includes(name)).map(name=>{const provider=this.registry.get(name);const metric=db.prepare("SELECT AVG(success)*100 success,AVG(latency_ms) latency FROM provider_metrics WHERE provider=? AND created_at>=datetime('now','-1 hour')").get(name);return {name,provider,score:(metric.success??100)-(metric.latency??0)/1000}}).filter(x=>x.provider.configured()&&!(x.provider.circuitOpenUntil>Date.now())).sort((a,b)=>b.score-a.score);
    if(!scored.length)throw new Error('Tidak ada provider pembayaran yang sehat untuk metode ini.');
    return scored[0];
  }
}
