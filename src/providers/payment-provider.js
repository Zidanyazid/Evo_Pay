export class PaymentProvider {
  async createPayment() { throw new Error('createPayment must be implemented'); }
  async getPaymentStatus() { throw new Error('getPaymentStatus must be implemented'); }
  verifyWebhook() { throw new Error('verifyWebhook must be implemented'); }
}
