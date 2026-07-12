import db from '../database.js';

export class RoutingService {
  constructor(registry) { this.registry = registry; }

  async candidates(merchantId, method, amount = 0) {
    const configs = await db.all(
      `SELECT provider,priority,weight FROM provider_route_configs WHERE is_active=1 AND (merchant_id=? OR merchant_id IS NULL) AND (payment_method=? OR payment_method IS NULL) AND (min_amount IS NULL OR min_amount<=?) AND (max_amount IS NULL OR max_amount>=?) ORDER BY CASE WHEN merchant_id IS NULL THEN 1 ELSE 0 END,priority DESC,weight DESC`,
      [merchantId, method, amount, amount]
    );
    const rules = await db.all(
      `SELECT provider,priority FROM routing_rules WHERE is_active=1 AND (merchant_id=? OR merchant_id IS NULL) AND (payment_method=? OR payment_method IS NULL) ORDER BY CASE WHEN merchant_id IS NULL THEN 1 ELSE 0 END,priority DESC`,
      [merchantId, method]
    );
    const ordered = [...configs.map((item) => item.provider), ...rules.map((item) => item.provider), ...this.registry.available()];
    return [...new Set(ordered)].filter((name) => {
      const provider = this.registry.get(name);
      const capabilities = provider.capabilities?.();
      return !capabilities?.methods || capabilities.methods.includes(method);
    });
  }

  async select(merchantId, method, amount = 0, excluded = []) {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const candidates = await this.candidates(merchantId, method, amount);
    const scored = (await Promise.all(candidates.filter((name) => !excluded.includes(name)).map(async (name) => {
      const provider = this.registry.get(name);
      const metric = await db.get('SELECT AVG(success)*100 success,AVG(latency_ms) latency FROM provider_metrics WHERE provider=? AND created_at>=?', [name, cutoff]);
      return { name, provider, score: (metric?.success ?? 100) - (metric?.latency ?? 0) / 1000 };
    }))).filter((item) => item.provider.configured() && !(item.provider.circuitOpenUntil > Date.now())).sort((a, b) => b.score - a.score);
    if (!scored.length) throw new Error('Tidak ada provider pembayaran yang sehat untuk metode ini.');
    return scored[0];
  }
}
