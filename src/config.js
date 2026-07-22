import crypto from 'node:crypto';

const numeric=(name,fallback,{min=1,max=Number.MAX_SAFE_INTEGER}={})=>{const value=Number(process.env[name]??fallback);return{value,valid:Number.isFinite(value)&&Number.isInteger(value)&&value>=min&&value<=max}};
const sessionTtl=numeric('ADMIN_SESSION_TTL_MS',28_800_000,{min:300_000,max:86_400_000});
const rateLimit=numeric('MERCHANT_RATE_LIMIT',120,{min:1,max:100_000});
const webhookTimeout=numeric('WEBHOOK_TIMEOUT_MS',8000,{min:500,max:60_000});
const workerInterval=numeric('WORKER_INTERVAL_MS',5000,{min:500,max:300_000});
export const config = {
  production: process.env.NODE_ENV === 'production',
  baseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  sessionTtlMs: sessionTtl.value, rateLimit: rateLimit.value, webhookTimeoutMs: webhookTimeout.value,
  workerIntervalMs: workerInterval.value,
  encryptionKey: crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || process.env.ADMIN_PASSWORD || 'nexuspay-development-key').digest(),
  webhookRetries: [0, 30, 120, 600, 3600, 21600]
};

export function productionConfigErrors(env=process.env) {
  if(env.NODE_ENV!=='production')return[];const errors=[];let url;
  try{url=new URL(env.APP_BASE_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)errors.push('APP_BASE_URL harus URL HTTPS publik tanpa credential, query, atau fragment.');}catch{errors.push('APP_BASE_URL wajib berupa URL HTTPS yang valid.');}
  if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<14||/change-this|password|nexuspay/i.test(env.ADMIN_PASSWORD))errors.push('ADMIN_PASSWORD wajib unik dan minimal 14 karakter.');
  if(!env.ENCRYPTION_KEY||env.ENCRYPTION_KEY.length<32||/replace-with|development/i.test(env.ENCRYPTION_KEY))errors.push('ENCRYPTION_KEY wajib random dan minimal 32 karakter.');
  if(!env.TOKOPAY_MERCHANT_ID||!env.TOKOPAY_SECRET)errors.push('Kredensial Tokopay wajib tersedia.');
  if(env.SIMULATOR_ENABLED!=='0')errors.push('SIMULATOR_ENABLED harus 0.');
  if(!env.DB_HOST||!env.DB_NAME||!env.DB_USER)errors.push('Konfigurasi MySQL DB_HOST, DB_NAME, dan DB_USER wajib ditentukan.');
  if(env.DB_NAME!=='sql_nexuspay_evogamestore_com')errors.push('DB_NAME harus sql_nexuspay_evogamestore_com pada deployment EvoGameStore.');
  if(!env.DB_PASSWORD)errors.push('DB_PASSWORD wajib diisi pada produksi.');
  if(!['0','1'].includes(env.TRUST_PROXY||'0'))errors.push('TRUST_PROXY hanya mendukung 0 atau 1.');
  for(const [name,result] of [['ADMIN_SESSION_TTL_MS',sessionTtl],['MERCHANT_RATE_LIMIT',rateLimit],['WEBHOOK_TIMEOUT_MS',webhookTimeout],['WORKER_INTERVAL_MS',workerInterval]])if(env[name]!=null&&!result.valid)errors.push(`${name} berada di luar rentang aman.`);
  return errors;
}
export function assertProductionConfig(){const errors=productionConfigErrors();if(errors.length)throw new Error(`Konfigurasi produksi tidak aman:\n- ${errors.join('\n- ')}`);}

