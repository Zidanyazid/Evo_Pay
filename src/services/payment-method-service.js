import db, { now } from '../database.js';
import { PAYMENT_METHODS, normalizePaymentMethod, paymentMethodByCode } from '../payment-methods.js';

const validationError=(message,code='VALIDATION_ERROR')=>Object.assign(new Error(message),{status:422,code});
const rowToMethod=(item,row={})=>({ ...item,is_enabled:Boolean(row.is_enabled),fee_bearer:row.fee_bearer||'CUSTOMER',admin_fee_fixed:Number(row.admin_fee_fixed??item.adminFeeFixed),admin_fee_percentage:Number(row.admin_fee_percentage??item.adminFeePercentage),settlement_label:row.settlement_label||item.settlementLabel,minimum_amount:Number(row.minimum_amount??item.minimumAmount),maximum_amount:row.maximum_amount==null?item.maximumAmount:Number(row.maximum_amount),requires_registration:Boolean(item.requiresRegistration) });

export class PaymentMethodService {
  seedMerchant(merchantId) {
    const insert=db.prepare(`INSERT OR IGNORE INTO merchant_payment_methods (merchant_id,payment_method,is_enabled,fee_bearer,admin_fee_fixed,admin_fee_percentage,settlement_label,minimum_amount,maximum_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const legacy=db.prepare(`UPDATE merchant_payment_methods SET is_enabled=?,fee_bearer='CUSTOMER',admin_fee_fixed=?,admin_fee_percentage=?,settlement_label=?,minimum_amount=?,maximum_amount=?,updated_at=? WHERE merchant_id=? AND payment_method=? AND admin_fee_fixed=0 AND admin_fee_percentage=0 AND settlement_label='Sesuai akun Tokopay' AND minimum_amount=1000 AND maximum_amount IS NULL`);
    const timestamp=now(); db.transaction(()=>PAYMENT_METHODS.forEach((item)=>{insert.run(merchantId,item.code,item.defaultEnabled?1:0,'CUSTOMER',item.adminFeeFixed,item.adminFeePercentage,item.settlementLabel,item.minimumAmount,item.maximumAmount,timestamp,timestamp);legacy.run(item.defaultEnabled?1:0,item.adminFeeFixed,item.adminFeePercentage,item.settlementLabel,item.minimumAmount,item.maximumAmount,timestamp,merchantId,item.code);}))();
  }
  seedAll() { db.prepare('SELECT id FROM merchants').all().forEach(({id})=>this.seedMerchant(id)); }
  list(merchantId) { this.seedMerchant(merchantId); const states=new Map(db.prepare('SELECT * FROM merchant_payment_methods WHERE merchant_id=?').all(merchantId).map((row)=>[row.payment_method,row])); return PAYMENT_METHODS.map((item)=>rowToMethod(item,states.get(item.code))); }
  configuration(merchantId,value) { const code=normalizePaymentMethod(value),method=paymentMethodByCode(code); if(!method) throw validationError('Metode pembayaran tidak dikenal.','PAYMENT_METHOD_UNKNOWN'); this.seedMerchant(merchantId); return rowToMethod(method,db.prepare('SELECT * FROM merchant_payment_methods WHERE merchant_id=? AND payment_method=?').get(merchantId,code)); }
  assertEnabled(merchantId,value,amount=null) { const method=this.configuration(merchantId,value); if(method.requires_registration) throw validationError(`Metode pembayaran ${method.code} memerlukan pendaftaran merchant.`,'PAYMENT_METHOD_REGISTRATION_REQUIRED'); if(!method.is_enabled) throw validationError(`Metode pembayaran ${method.code} sedang nonaktif untuk merchant ini.`,'PAYMENT_METHOD_DISABLED'); if(amount!=null&&(amount<method.minimum_amount||(method.maximum_amount!=null&&amount>method.maximum_amount))) throw validationError(`Nominal ${method.code} harus antara Rp${method.minimum_amount.toLocaleString('id-ID')} dan ${method.maximum_amount==null?'tanpa batas maksimum':`Rp${method.maximum_amount.toLocaleString('id-ID')}`}.`,'PAYMENT_AMOUNT_OUT_OF_RANGE'); return method; }
  update(merchantId,value,input={}) {
    const current=this.configuration(merchantId,value),bearer=String(input.fee_bearer??current.fee_bearer).toUpperCase();
    const fixed=Number(input.admin_fee_fixed??current.admin_fee_fixed),percentage=Number(input.admin_fee_percentage??current.admin_fee_percentage),minimum=Number(input.minimum_amount??current.minimum_amount),maximum=input.maximum_amount==null||input.maximum_amount===''?null:Number(input.maximum_amount),settlement=String(input.settlement_label??current.settlement_label).trim(),enabled=Boolean(input.is_enabled??current.is_enabled);
    if(current.requires_registration&&enabled) throw validationError('Channel ini memerlukan pendaftaran merchant sebelum dapat diaktifkan.','PAYMENT_METHOD_REGISTRATION_REQUIRED');
    if(!['MERCHANT','CUSTOMER'].includes(bearer)) throw validationError('Penanggung biaya harus MERCHANT atau CUSTOMER.');
    if(!Number.isInteger(fixed)||fixed<0||!Number.isFinite(percentage)||percentage<0||percentage>100) throw validationError('Biaya admin tidak valid.');
    if(!Number.isInteger(minimum)||minimum<1||(maximum!=null&&(!Number.isInteger(maximum)||maximum<minimum))) throw validationError('Minimum–maksimum pembayaran tidak valid.');
    if(!settlement||settlement.length>80) throw validationError('Informasi settlement wajib diisi dan maksimal 80 karakter.');
    db.prepare('UPDATE merchant_payment_methods SET is_enabled=?,fee_bearer=?,admin_fee_fixed=?,admin_fee_percentage=?,settlement_label=?,minimum_amount=?,maximum_amount=?,updated_at=? WHERE merchant_id=? AND payment_method=?').run(enabled?1:0,bearer,fixed,percentage,settlement,minimum,maximum,now(),merchantId,current.code);
    return this.configuration(merchantId,current.code);
  }
}
