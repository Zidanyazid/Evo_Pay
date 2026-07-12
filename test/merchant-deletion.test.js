import test from 'node:test';
import assert from 'node:assert/strict';
import db, { hashApiKey, id, now } from '../src/database.js';
import { PaymentMethodService } from '../src/services/payment-method-service.js';
import { deleteMerchant } from '../src/services/merchant-deletion-service.js';

const createMerchant=(name)=>{const merchantId=id('m_delete');db.prepare('INSERT INTO merchants (id,name,api_key_hash,created_at) VALUES (?,?,?,?)').run(merchantId,name,hashApiKey(id('key')),now());new PaymentMethodService().seedMerchant(merchantId);return merchantId;};

test('deletes empty merchant, dependent configuration, and records audit',()=>{const merchantId=createMerchant('Delete Empty');const result=deleteMerchant({merchantId,confirmationName:'Delete Empty',actorId:null});assert.equal(result.deleted,true);assert.equal(db.prepare('SELECT 1 FROM merchants WHERE id=?').get(merchantId),undefined);assert.equal(db.prepare('SELECT COUNT(*) count FROM merchant_payment_methods WHERE merchant_id=?').get(merchantId).count,0);const audit=db.prepare("SELECT * FROM audit_logs WHERE action='MERCHANT_DELETED' AND target_id=?").get(merchantId);assert.ok(audit);assert.equal(JSON.parse(audit.metadata_json).name,'Delete Empty');});
test('rejects mismatched confirmation without modifying merchant',()=>{const merchantId=createMerchant('Exact Name');assert.throws(()=>deleteMerchant({merchantId,confirmationName:'exact name'}),(error)=>error.code==='MERCHANT_CONFIRMATION_MISMATCH'&&error.status===422);assert.ok(db.prepare('SELECT 1 FROM merchants WHERE id=?').get(merchantId));});
test('rejects deletion when merchant has payment history',()=>{const merchantId=createMerchant('Has History'),timestamp=now();db.prepare('INSERT INTO payments (id,merchant_id,merchant_order_id,provider,payment_method,amount,total_amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id('pay'),merchantId,id('order'),'tokopay','QRIS',1000,1000,'PENDING',timestamp,timestamp);assert.throws(()=>deleteMerchant({merchantId,confirmationName:'Has History'}),(error)=>error.code==='MERCHANT_HAS_HISTORY'&&error.status===409);assert.ok(db.prepare('SELECT 1 FROM merchants WHERE id=?').get(merchantId));});
test('returns structured not found error',()=>{assert.throws(()=>deleteMerchant({merchantId:'m_missing',confirmationName:'Missing'}),(error)=>error.code==='MERCHANT_NOT_FOUND'&&error.status===404);});
