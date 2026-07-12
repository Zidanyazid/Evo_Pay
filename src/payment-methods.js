const method = (code,name,category,defaultEnabled,adminFeeFixed,adminFeePercentage,settlementLabel,minimumAmount,maximumAmount,requiresRegistration=false) => ({ code,name,category,defaultEnabled,provider:'tokopay',adminFeeFixed,adminFeePercentage,settlementLabel,minimumAmount,maximumAmount,requiresRegistration });

export const PAYMENT_METHODS = Object.freeze([
  method('BRIVA','BRI VA','VIRTUAL_ACCOUNT',true,3000,0,'H+1',10000,10000000),
  method('BCAVA','BCA VA','VIRTUAL_ACCOUNT',true,4200,0,'H+2',10000,10000000),
  method('BNIVA','BNI VA','VIRTUAL_ACCOUNT',true,3500,0,'H+0',10000,50000000),
  method('MANDIRIVA','Mandiri VA','VIRTUAL_ACCOUNT',true,3500,0,'H+0',10000,50000000),
  method('PERMATAVA','Permata VA','VIRTUAL_ACCOUNT',false,2000,0,'H+1',10000,5000000),
  method('CIMBVA','CIMB VA','VIRTUAL_ACCOUNT',true,2500,0,'H+0',10000,50000000),
  method('DANAMONVA','Danamon VA','VIRTUAL_ACCOUNT',false,2500,0,'H+0',10000,50000000),
  method('BSIVA','BSI Virtual Account','VIRTUAL_ACCOUNT',true,3500,0,'H+1',10000,2000000),
  method('BNCVA','BNC VA (NEO)','VIRTUAL_ACCOUNT',false,3000,0,'H+1',10000,5000000),
  method('PERMATAVAA','Permata VA','VIRTUAL_ACCOUNT',false,3000,0,'H+1',10000,5000000),
  method('SHOPEEPAY','ShopeePay','E_MONEY',true,0,2.5,'H+1',100,2000000),
  method('GOPAY','GoPay','E_MONEY',true,0,3,'H+1',100,2000000),
  method('DANA','DANA','E_MONEY',true,0,2.5,'H+1',10,50000000),
  method('LINKAJA','LinkAja','E_MONEY',true,0,3,'H+1',10,2000000),
  method('VIRGO','Virgo','E_MONEY',false,0,2,'H+1',1000,10000000),
  method('ASTRAPAY','AstraPay','E_MONEY',false,0,2.5,'H+1',10,10000000),
  method('OVOPUSH','OVO','E_MONEY',true,0,2.5,'H+1',100,10000000),
  method('DANA_REALTIME','DANA Realtime','E_MONEY',false,0,3.2,'H+0',10,50000000),
  method('SHOPEEPAY_REALTIME','ShopeePay Realtime','E_MONEY',false,0,3,'H+0',100,2000000),
  method('GOPAY_REALTIME','GoPay Realtime','E_MONEY',false,0,3.5,'H+0',100,2000000),
  method('OVOPUSH_REALTIME','OVO Realtime','E_MONEY',false,0,2.7,'H+0',100,10000000),
  method('QRIS','QRIS','QRIS',true,100,0.7,'H+1',100,15000000),
  method('QRISREALTIME','QRIS Realtime','QRIS',true,0,1.7,'H+0',100,10000000),
  method('QRIS_CUSTOM','QRIS CUSTOM NAME','QRIS',false,250,0.7,'H+0',100,15000000,true),
  method('ALFAMART','Alfamart','RETAIL',true,3500,0,'H+3',10000,2000000),
  method('INDOMARET','Indomaret','RETAIL',true,3500,0,'H+3',10000,2000000)
].map(Object.freeze));
export const PAYMENT_METHOD_CODES = new Set(PAYMENT_METHODS.map((item) => item.code));
export const PAYMENT_METHOD_ALIASES = Object.freeze({ VA_BRI:'BRIVA',VA_BCA:'BCAVA',VA_BNI:'BNIVA',VA_MANDIRI:'MANDIRIVA',SHOPEE_PAY:'SHOPEEPAY',LINK_AJA:'LINKAJA',OVO:'OVOPUSH',QRIS_REALTIME:'QRISREALTIME',QRIS_REALTIME_NOBU:'QRISREALTIME' });
export function normalizePaymentMethod(value) { const code=String(value||'').trim().toUpperCase(); return PAYMENT_METHOD_ALIASES[code]||code; }
export function paymentMethodByCode(value) { const code=normalizePaymentMethod(value); return PAYMENT_METHODS.find((item)=>item.code===code)||null; }
