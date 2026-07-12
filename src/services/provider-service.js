import db,{id,now} from '../database.js';

export class ProviderService {
  constructor(registry) { this.registry = registry; }

  async record(provider, success, latency, errorClass = null) {
    await db.run(
      'INSERT INTO provider_metrics(id,provider,success,latency_ms,error_class,created_at) VALUES(?,?,?,?,?,?)',
      [id('met'), provider, success ? 1 : 0, Math.round(latency), errorClass, now()]
    );
  }

  async probe(name) {
    const provider = this.registry.get(name);
    const started = Date.now();
    let success = false;
    let error = null;
    try {
      if (!provider.configured()) throw new Error('NOT_CONFIGURED');
      success = true;
    } catch (caught) { error = caught.message; }
    await this.record(name, success, Date.now() - started, error);
    await db.run('UPDATE providers SET health_status=?,last_checked_at=? WHERE id=?', [success ? 'HEALTHY' : 'DOWN', now(), name]);
    return { name, success, error };
  }

  async summary() {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    return Promise.all(this.registry.health().map(async (item) => {
      const metrics = await db.get('SELECT COUNT(*) total,SUM(success) successes,AVG(latency_ms) latency FROM provider_metrics WHERE provider=? AND created_at>=?', [item.name, cutoff]);
      return { ...item, success_rate: metrics.total ? Math.round(metrics.successes / metrics.total * 10000) / 100 : null, latency_ms: metrics.latency ? Math.round(metrics.latency) : null };
    }));
  }
}
