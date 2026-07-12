import db from '../database.js';

export async function calculateFee({ merchantId, provider, method, amount, methodConfig = null }) {
  const config = methodConfig || await db.get('SELECT * FROM merchant_payment_methods WHERE merchant_id=? AND payment_method=?', [merchantId, method]);
  if (config && (Number(config.admin_fee_fixed || 0) > 0 || Number(config.admin_fee_percentage || 0) > 0)) {
    const fee = Number(config.admin_fee_fixed || 0) + Math.round(amount * Number(config.admin_fee_percentage || 0) / 100);
    const bearer = config.fee_bearer || 'MERCHANT';
    return { fee, customerFee: bearer === 'CUSTOMER' ? fee : 0, merchantFee: bearer === 'MERCHANT' ? fee : 0, ruleId: null, source: 'PAYMENT_METHOD', bearer, fixedFee: Number(config.admin_fee_fixed || 0), percentage: Number(config.admin_fee_percentage || 0) };
  }
  const rule = await db.get(
    `SELECT * FROM fee_rules WHERE is_active=1 AND (merchant_id=? OR merchant_id IS NULL) AND (provider=? OR provider IS NULL) AND (payment_method=? OR payment_method IS NULL) ORDER BY merchant_id IS NOT NULL DESC,provider IS NOT NULL DESC,payment_method IS NOT NULL DESC,priority DESC LIMIT 1`,
    [merchantId, provider, method]
  );
  if (!rule) return { fee: 0, customerFee: 0, merchantFee: 0, ruleId: null, source: 'NONE', bearer: config?.fee_bearer || 'MERCHANT', fixedFee: 0, percentage: 0 };
  const raw = Number(rule.fixed_fee || 0) + Math.round(amount * Number(rule.percentage || 0) / 100);
  const fee = Math.max(Number(rule.minimum_fee || 0), Math.min(raw, rule.maximum_fee == null ? raw : Number(rule.maximum_fee)));
  return { fee, customerFee: rule.bearer === 'CUSTOMER' ? fee : 0, merchantFee: rule.bearer === 'MERCHANT' ? fee : 0, ruleId: rule.id, source: 'FEE_RULE', bearer: rule.bearer, fixedFee: Number(rule.fixed_fee || 0), percentage: Number(rule.percentage || 0) };
}
