import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = process.env.DATABASE_PATH || './data/gateway.db';
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key_hash TEXT NOT NULL UNIQUE,
    callback_url TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id),
    merchant_order_id TEXT NOT NULL, provider TEXT NOT NULL, provider_reference TEXT UNIQUE,
    provider_transaction_id TEXT, payment_method TEXT NOT NULL, amount INTEGER NOT NULL,
    total_amount INTEGER NOT NULL, status TEXT NOT NULL, customer_name TEXT,
    customer_email TEXT, customer_phone TEXT, description TEXT, payment_code TEXT,
    payment_url TEXT, qr_string TEXT, instructions_json TEXT, expires_at TEXT,
    paid_at TEXT, provider_payload_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(merchant_id, merchant_order_id)
  );
  CREATE TABLE IF NOT EXISTS payment_events (
    id TEXT PRIMARY KEY, payment_id TEXT REFERENCES payments(id), provider TEXT NOT NULL,
    event_type TEXT NOT NULL, signature_valid INTEGER, payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id),
    url TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0, response_code INTEGER, last_error TEXT,
    delivered_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'viewer',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,last_login_at TEXT);
  CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES admin_users(id),token_hash TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,ip TEXT,user_agent TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,target_type TEXT,target_id TEXT,ip TEXT,user_agent TEXT,metadata_json TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS merchant_ip_allowlist (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),cidr TEXT NOT NULL,label TEXT,is_active INTEGER NOT NULL DEFAULT 1,created_by TEXT,last_matched_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(merchant_id,cidr));
  CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY,name TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,priority INTEGER NOT NULL DEFAULT 100,health_status TEXT NOT NULL DEFAULT 'UNKNOWN',last_checked_at TEXT,metadata_json TEXT);
  CREATE TABLE IF NOT EXISTS routing_rules (id TEXT PRIMARY KEY,merchant_id TEXT,payment_method TEXT,provider TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 100,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS payment_attempts (id TEXT PRIMARY KEY,payment_id TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS fee_rules (id TEXT PRIMARY KEY,name TEXT NOT NULL,merchant_id TEXT,provider TEXT,payment_method TEXT,fixed_fee INTEGER NOT NULL DEFAULT 0,percentage REAL NOT NULL DEFAULT 0,minimum_fee INTEGER NOT NULL DEFAULT 0,maximum_fee INTEGER,bearer TEXT NOT NULL DEFAULT 'MERCHANT',priority INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY,payment_id TEXT NOT NULL,merchant_id TEXT NOT NULL,amount INTEGER NOT NULL,reason TEXT,status TEXT NOT NULL,requested_by TEXT,approved_by TEXT,provider_reference TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS disputes (id TEXT PRIMARY KEY,payment_id TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ledger_accounts (id TEXT PRIMARY KEY,merchant_id TEXT,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ledger_transactions (id TEXT PRIMARY KEY,reference_type TEXT NOT NULL,reference_id TEXT NOT NULL,idempotency_key TEXT UNIQUE NOT NULL,description TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ledger_entries (id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),account_id TEXT NOT NULL REFERENCES ledger_accounts(id),direction TEXT NOT NULL,amount INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,destination_json TEXT,requested_by TEXT,approved_by TEXT,notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reconciliation_runs (id TEXT PRIMARY KEY,provider TEXT NOT NULL,status TEXT NOT NULL,checked_count INTEGER NOT NULL DEFAULT 0,mismatch_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT);
  CREATE TABLE IF NOT EXISTS reconciliation_items (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,payment_id TEXT,issue_type TEXT NOT NULL,local_status TEXT,provider_status TEXT,details_json TEXT,resolution_status TEXT NOT NULL DEFAULT 'OPEN',created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notification_channels (id TEXT PRIMARY KEY,type TEXT NOT NULL,name TEXT NOT NULL,config_json TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notification_events (id TEXT PRIMARY KEY,channel_id TEXT,event_type TEXT NOT NULL,dedup_key TEXT,status TEXT NOT NULL,payload_json TEXT,error TEXT,created_at TEXT NOT NULL,sent_at TEXT);
  CREATE TABLE IF NOT EXISTS api_nonces (merchant_id TEXT NOT NULL,nonce TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(merchant_id,nonce));
  CREATE TABLE IF NOT EXISTS idempotency_keys (scope TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,response_code INTEGER,response_json TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(scope,key));
  CREATE TABLE IF NOT EXISTS api_credentials (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),name TEXT NOT NULL,key_prefix TEXT NOT NULL,key_hash TEXT UNIQUE NOT NULL,secret_encrypted TEXT,environment TEXT NOT NULL DEFAULT 'live',scopes_json TEXT NOT NULL DEFAULT '["payments:write","payments:read"]',expires_at TEXT,last_used_at TEXT,revoked_at TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS merchant_users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,totp_secret_encrypted TEXT,created_at TEXT NOT NULL,last_login_at TEXT);
  CREATE TABLE IF NOT EXISTS merchant_memberships (user_id TEXT NOT NULL REFERENCES merchant_users(id),merchant_id TEXT NOT NULL REFERENCES merchants(id),role TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,merchant_id));
  CREATE TABLE IF NOT EXISTS payment_links (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),slug TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT,amount INTEGER,allow_custom_amount INTEGER NOT NULL DEFAULT 0,min_amount INTEGER,max_amount INTEGER,usage_limit INTEGER,usage_count INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'ACTIVE',expires_at TEXT,redirect_url TEXT,metadata_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY,action_type TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,requested_by TEXT NOT NULL,approved_by TEXT,status TEXT NOT NULL DEFAULT 'PENDING',payload_json TEXT,decision_notes TEXT,created_at TEXT NOT NULL,decided_at TEXT);
  CREATE TABLE IF NOT EXISTS risk_rules (id TEXT PRIMARY KEY,name TEXT NOT NULL,signal TEXT NOT NULL,operator TEXT NOT NULL,threshold REAL NOT NULL,window_seconds INTEGER,score INTEGER NOT NULL DEFAULT 0,action TEXT NOT NULL DEFAULT 'REVIEW',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS risk_events (id TEXT PRIMARY KEY,payment_id TEXT,merchant_id TEXT NOT NULL,score INTEGER NOT NULL,decision TEXT NOT NULL,signals_json TEXT NOT NULL,review_status TEXT,reviewed_by TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS provider_metrics (id TEXT PRIMARY KEY,provider TEXT NOT NULL,success INTEGER NOT NULL,latency_ms INTEGER,error_class TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS provider_incidents (id TEXT PRIMARY KEY,provider TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,severity TEXT NOT NULL,message TEXT,started_at TEXT NOT NULL,resolved_at TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS system_jobs (id TEXT PRIMARY KEY,type TEXT NOT NULL,payload_json TEXT,status TEXT NOT NULL DEFAULT 'PENDING',run_at TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,lease_owner TEXT,lease_expires_at TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS onboarding_applications (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL UNIQUE REFERENCES merchants(id),legal_name TEXT,business_type TEXT,email_verified_at TEXT,phone_verified_at TEXT,bank_name TEXT,bank_account_last4 TEXT,bank_owner_name TEXT,status TEXT NOT NULL DEFAULT 'DRAFT',risk_tier TEXT NOT NULL DEFAULT 'STANDARD',reviewer_id TEXT,review_notes TEXT,revision INTEGER NOT NULL DEFAULT 1,submitted_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS kyc_documents (id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES onboarding_applications(id),document_type TEXT NOT NULL,file_name TEXT NOT NULL,storage_key TEXT NOT NULL,checksum TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'UPLOADED',review_notes TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS subscription_plans (id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,monthly_price INTEGER NOT NULL DEFAULT 0,limits_json TEXT NOT NULL,entitlements_json TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS merchant_subscriptions (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),plan_id TEXT NOT NULL REFERENCES subscription_plans(id),status TEXT NOT NULL,trial_ends_at TEXT,current_period_start TEXT,current_period_end TEXT,grace_ends_at TEXT,coupon_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usage_counters (merchant_id TEXT NOT NULL,metric TEXT NOT NULL,period TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(merchant_id,metric,period));
  CREATE TABLE IF NOT EXISTS webhook_attempts (id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES webhook_deliveries(id),attempt_number INTEGER NOT NULL,response_code INTEGER,response_body TEXT,error TEXT,latency_ms INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS payment_notes (id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),author_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS saved_filters (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,resource TEXT NOT NULL,filters_json TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS admin_recovery_codes (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES admin_users(id),code_hash TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS in_app_notifications (id TEXT PRIMARY KEY,user_id TEXT,event_type TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,metadata_json TEXT,read_at TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),name TEXT,email TEXT,phone TEXT,notes TEXT,metadata_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),customer_id TEXT REFERENCES customers(id),number TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',currency TEXT NOT NULL DEFAULT 'IDR',subtotal INTEGER NOT NULL DEFAULT 0,tax_amount INTEGER NOT NULL DEFAULT 0,discount_amount INTEGER NOT NULL DEFAULT 0,total_amount INTEGER NOT NULL DEFAULT 0,due_at TEXT,description TEXT,payment_id TEXT REFERENCES payments(id),portal_token_hash TEXT,sent_at TEXT,viewed_at TEXT,paid_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(merchant_id,number));
  CREATE TABLE IF NOT EXISTS invoice_items (id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT,quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,amount INTEGER NOT NULL,position INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS invoice_reminders (id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',scheduled_at TEXT NOT NULL,sent_at TEXT,error TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS promotions (id TEXT PRIMARY KEY,merchant_id TEXT REFERENCES merchants(id),code TEXT NOT NULL,type TEXT NOT NULL,value INTEGER NOT NULL,min_amount INTEGER NOT NULL DEFAULT 0,max_discount INTEGER,usage_limit INTEGER,usage_count INTEGER NOT NULL DEFAULT 0,payment_method TEXT,starts_at TEXT,ends_at TEXT,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(merchant_id,code));
  CREATE TABLE IF NOT EXISTS promotion_redemptions (id TEXT PRIMARY KEY,promotion_id TEXT NOT NULL REFERENCES promotions(id),payment_id TEXT REFERENCES payments(id),customer_id TEXT REFERENCES customers(id),discount_amount INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customer_portal_sessions (id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),token_hash TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,last_used_at TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS payment_link_visits (id TEXT PRIMARY KEY,link_id TEXT NOT NULL REFERENCES payment_links(id),session_hash TEXT,converted_payment_id TEXT REFERENCES payments(id),created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recurring_plans (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),name TEXT NOT NULL,amount INTEGER NOT NULL,interval_unit TEXT NOT NULL,interval_count INTEGER NOT NULL DEFAULT 1,trial_days INTEGER NOT NULL DEFAULT 0,retry_limit INTEGER NOT NULL DEFAULT 3,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recurring_subscriptions (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),plan_id TEXT NOT NULL REFERENCES recurring_plans(id),customer_id TEXT NOT NULL REFERENCES customers(id),status TEXT NOT NULL,provider_token_encrypted TEXT,current_period_start TEXT,current_period_end TEXT,next_charge_at TEXT,retry_count INTEGER NOT NULL DEFAULT 0,cancel_at_period_end INTEGER NOT NULL DEFAULT 0,paused_at TEXT,cancelled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS billing_cycles (id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES recurring_subscriptions(id),period_start TEXT NOT NULL,period_end TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,payment_id TEXT REFERENCES payments(id),attempt_count INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(subscription_id,period_start));
  CREATE TABLE IF NOT EXISTS saved_reports (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES admin_users(id),merchant_id TEXT REFERENCES merchants(id),name TEXT NOT NULL,resource TEXT NOT NULL,filters_json TEXT NOT NULL,columns_json TEXT NOT NULL,schedule_cron TEXT,is_active INTEGER NOT NULL DEFAULT 1,last_run_at TEXT,next_run_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS report_runs (id TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES saved_reports(id),status TEXT NOT NULL,row_count INTEGER NOT NULL DEFAULT 0,output_json TEXT,error TEXT,created_at TEXT NOT NULL,completed_at TEXT);
  CREATE TABLE IF NOT EXISTS reconciliation_imports (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES reconciliation_runs(id),file_name TEXT NOT NULL,checksum TEXT NOT NULL,row_count INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS provider_route_configs (id TEXT PRIMARY KEY,merchant_id TEXT REFERENCES merchants(id),payment_method TEXT,provider TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 100,weight INTEGER NOT NULL DEFAULT 100,min_amount INTEGER,max_amount INTEGER,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS incident_updates (id TEXT PRIMARY KEY,incident_id TEXT NOT NULL REFERENCES provider_incidents(id) ON DELETE CASCADE,status TEXT NOT NULL,message TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dispute_evidence (id TEXT PRIMARY KEY,dispute_id TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,type TEXT NOT NULL,file_name TEXT,storage_key TEXT,content TEXT,checksum TEXT,created_by TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dispute_events (id TEXT PRIMARY KEY,dispute_id TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,from_status TEXT,to_status TEXT NOT NULL,notes TEXT,actor_id TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sandbox_sessions (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),name TEXT NOT NULL,scenario TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE',created_by TEXT,expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sandbox_events (id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sandbox_sessions(id) ON DELETE CASCADE,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,sequence INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(session_id,sequence));
  CREATE TABLE IF NOT EXISTS webhook_playground_events (id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),event_type TEXT NOT NULL,url TEXT NOT NULL,payload_json TEXT NOT NULL,headers_json TEXT NOT NULL,response_code INTEGER,response_body TEXT,status TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS retention_policies (id TEXT PRIMARY KEY,resource TEXT UNIQUE NOT NULL,retention_days INTEGER NOT NULL,action TEXT NOT NULL DEFAULT 'DELETE',is_active INTEGER NOT NULL DEFAULT 1,legal_hold INTEGER NOT NULL DEFAULT 0,updated_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_exports (id TEXT PRIMARY KEY,requested_by TEXT NOT NULL,filters_json TEXT NOT NULL,row_count INTEGER NOT NULL,format TEXT NOT NULL,checksum TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS compliance_assessments (id TEXT PRIMARY KEY,merchant_id TEXT REFERENCES merchants(id),framework TEXT NOT NULL,status TEXT NOT NULL,score INTEGER NOT NULL,checks_json TEXT NOT NULL,assessed_by TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS onboarding_checks (id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES onboarding_applications(id) ON DELETE CASCADE,check_type TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(application_id,check_type));
  CREATE TABLE IF NOT EXISTS merchant_payment_methods (merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,payment_method TEXT NOT NULL,is_enabled INTEGER NOT NULL DEFAULT 0,fee_bearer TEXT NOT NULL DEFAULT 'MERCHANT',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(merchant_id,payment_method));

  CREATE INDEX IF NOT EXISTS idx_merchant_payment_methods_enabled ON merchant_payment_methods(merchant_id,is_enabled);

  CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status,created_at);
  CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status,updated_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_ip_allowlist_active ON merchant_ip_allowlist(merchant_id,is_active);
  CREATE INDEX IF NOT EXISTS idx_jobs_due ON system_jobs(status,run_at);
  CREATE INDEX IF NOT EXISTS idx_provider_metrics ON provider_metrics(provider,created_at);
  CREATE INDEX IF NOT EXISTS idx_risk_events ON risk_events(merchant_id,created_at);
`);

const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
const addColumn = (table, name, definition) => { if (!columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); };
[
  ['merchants','webhook_secret','TEXT'],['merchants','brand_json','TEXT'],['merchants','min_amount','INTEGER DEFAULT 1000'],['merchants','max_amount','INTEGER DEFAULT 100000000'],['merchants','ip_allowlist','TEXT'],['merchants','require_signature','INTEGER DEFAULT 0'],['merchants','onboarding_status',"TEXT DEFAULT 'DRAFT'"],['merchants','risk_tier',"TEXT DEFAULT 'STANDARD'"],['merchants','transaction_limit',"INTEGER DEFAULT 10000000"],
  ['payments','checkout_token','TEXT'],['payments','redirect_url','TEXT'],['payments','fee_amount','INTEGER DEFAULT 0'],['payments','net_amount','INTEGER DEFAULT 0'],['payments','fee_snapshot_json','TEXT'],
  ['api_credentials','rotation_parent_id','TEXT'],['api_credentials','overlap_ends_at','TEXT'],
  ['webhook_deliveries','event_type',"TEXT DEFAULT 'payment.paid'"],['webhook_deliveries','next_attempt_at','TEXT'],['webhook_deliveries','response_body','TEXT'],['webhook_deliveries','signature','TEXT'],
  ['refunds','idempotency_key','TEXT'],  ['admin_users','totp_secret_encrypted','TEXT'],['admin_users','totp_enabled','INTEGER DEFAULT 0'],['admin_users','locale',"TEXT DEFAULT 'id-ID'"],['admin_users','timezone',"TEXT DEFAULT 'Asia/Jakarta'"],['admin_users','username','TEXT'],['admin_sessions','last_seen_at','TEXT'],
  ['merchant_payment_methods','admin_fee_fixed','INTEGER NOT NULL DEFAULT 0'],['merchant_payment_methods','admin_fee_percentage','REAL NOT NULL DEFAULT 0'],['merchant_payment_methods','settlement_label',"TEXT NOT NULL DEFAULT 'Sesuai akun Tokopay'"],['merchant_payment_methods','minimum_amount','INTEGER NOT NULL DEFAULT 1000'],['merchant_payment_methods','maximum_amount','INTEGER']
].forEach(([table,name,definition]) => addColumn(table,name,definition));
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout_token ON payments(checkout_token);
  CREATE INDEX IF NOT EXISTS idx_credentials_merchant_environment ON api_credentials(merchant_id,environment,revoked_at);
  CREATE INDEX IF NOT EXISTS idx_onboarding_status ON onboarding_applications(status,updated_at);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_merchant ON merchant_subscriptions(merchant_id,status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_idempotency ON refunds(idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_webhook_attempts_delivery ON webhook_attempts(delivery_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON in_app_notifications(user_id,read_at,created_at);
`);

const migrationVersion = 3;
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(migrationVersion)) db.prepare('INSERT INTO schema_migrations (version,applied_at) VALUES (?,?)').run(migrationVersion, new Date().toISOString());

export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex');
export const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
export const verifyPassword = (password, stored = '') => { const [salt, expected] = stored.split(':'); if (!salt || !expected) return false; const actual = crypto.scryptSync(password, salt, 64); const target = Buffer.from(expected, 'hex'); return target.length === actual.length && crypto.timingSafeEqual(target, actual); };

const adminExists = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
if (!adminExists && process.env.ADMIN_PASSWORD) db.prepare('INSERT INTO admin_users (id,email,name,username,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)').run(id('usr'), process.env.ADMIN_EMAIL || 'admin@nexuspay.local', 'NexusPay Admin', process.env.ADMIN_USERNAME || 'admin', hashPassword(process.env.ADMIN_PASSWORD), 'owner', now());
if (adminExists) { const user = db.prepare('SELECT id,username FROM admin_users WHERE id=?').get(adminExists.id); if (user && !user.username) db.prepare('UPDATE admin_users SET username=? WHERE id=?').run(process.env.ADMIN_USERNAME || 'admin', user.id); }

const demoKey = process.env.DEMO_MERCHANT_API_KEY || 'np_demo_topup_please_change';
const demoExists = db.prepare('SELECT id FROM merchants WHERE id = ?').get('m_demo_topup');
if (process.env.NODE_ENV !== 'production' && !demoExists) {
  db.prepare('INSERT INTO merchants (id,name,api_key_hash,callback_url,created_at) VALUES (?,?,?,?,?)')
    .run('m_demo_topup', 'Demo Topup Store', hashApiKey(demoKey), null, now());
}

export default db;
