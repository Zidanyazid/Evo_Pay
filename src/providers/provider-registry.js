export class ProviderRegistry {
  constructor(providers = {}) { this.providers = new Map(Object.entries(providers)); }
  get(name) { const provider = this.providers.get(name); if (!provider) throw new Error(`Provider ${name} tidak tersedia.`); return provider; }
  available() { return [...this.providers.entries()].filter(([, item]) => item.configured()).map(([name]) => name); }
  health() { return [...this.providers.entries()].map(([name, item]) => ({ name, configured: item.configured(), circuit: item.circuitOpenUntil > Date.now() ? 'OPEN' : 'CLOSED' })); }
}
