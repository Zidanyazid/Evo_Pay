import crypto from 'node:crypto';
export class EvoPayError extends Error { constructor(message, { status, code, requestId } = {}) { super(message); this.name = 'EvoPayError'; this.status = status; this.code = code; this.requestId = requestId; } }
export class EvoPayClient {
  constructor({ baseUrl, apiKey, timeoutMs = 10000, fetchFn = fetch }) { if (!baseUrl || !apiKey) throw new Error('baseUrl dan apiKey wajib diisi.'); this.baseUrl = baseUrl.replace(/\/$/, ''); this.apiKey = apiKey; this.timeoutMs = timeoutMs; this.fetch = fetchFn; }
  async request(path, options = {}) { const requestId = crypto.randomUUID(); const response = await this.fetch(`${this.baseUrl}/api/v1${path}`, { ...options, headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'x-request-id': requestId, ...(options.headers || {}) }, signal: AbortSignal.timeout(this.timeoutMs) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new EvoPayError(body.error?.message || 'EvoPay request gagal.', { status: response.status, code: body.error?.code, requestId: response.headers.get('x-request-id') || requestId }); return body.data; }
  paymentMethods() { return this.request('/payment-methods'); }
  createPayment(input) { return this.request('/payments', { method: 'POST', body: JSON.stringify(input) }); }
  getPayment(paymentId) { return this.request(`/payments/${encodeURIComponent(paymentId)}`); }
  syncPayment(paymentId) { return this.request(`/payments/${encodeURIComponent(paymentId)}/sync`, { method: 'POST' }); }
}
