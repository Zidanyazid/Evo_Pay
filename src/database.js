import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

/* ── Connection pool ── */
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     Number(process.env.DB_PORT || 3306),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'evopay',
  waitForConnections: true,
  connectionLimit: 20,
  charset: 'utf8mb4',
  timezone: '+00:00',
  multipleStatements: true,
});

/* ── Compatibility wrapper ──
   Provides a familiar API surface so services can call:
     await db.get(sql, params)   → single row or undefined
     await db.all(sql, params)   → array of rows
     await db.run(sql, params)   → { changes, insertId }
     await db.exec(sql)          → raw multipleStatements execution
     await db.transaction(fn)    → fn receives conn with same {get,all,run} interface
*/
const db = {
  pool,

  async get(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows[0] || undefined;
  },

  async all(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  },

  async run(sql, params = []) {
    const [result] = await pool.execute(sql, params);
    return { changes: result.affectedRows, insertId: result.insertId };
  },

  async exec(sql) {
    const conn = await pool.getConnection();
    try { await conn.query(sql); }
    finally { conn.release(); }
  },

  async transaction(fn) {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const tx = {
      async get(sql, params = []) { const [rows] = await conn.execute(sql, params); return rows[0] || undefined; },
      async all(sql, params = []) { const [rows] = await conn.execute(sql, params); return rows; },
      async run(sql, params = []) { const [result] = await conn.execute(sql, params); return { changes: result.affectedRows, insertId: result.insertId }; },
    };
    try {
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async close() {
    await pool.end();
  }
};

/* ── Schema (MySQL dialect) ── */
export async function initDatabase() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at VARCHAR(50) NOT NULL);

    CREATE TABLE IF NOT EXISTS workspaces (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, slug VARCHAR(100) NOT NULL,
      created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_workspace_slug (slug)
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id VARCHAR(64) NOT NULL, user_id VARCHAR(64) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'viewer',
      is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL,
      PRIMARY KEY (workspace_id,user_id), INDEX idx_workspace_member_user (user_id,is_active)
    );

    CREATE TABLE IF NOT EXISTS merchants (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, api_key_hash VARCHAR(255) NOT NULL,
      callback_url TEXT, is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL,
      webhook_secret VARCHAR(255), brand_json JSON, min_amount INT DEFAULT 1000, max_amount INT DEFAULT 100000000,
      ip_allowlist TEXT, require_signature TINYINT DEFAULT 0, onboarding_status VARCHAR(20) DEFAULT 'DRAFT',
      risk_tier VARCHAR(20) DEFAULT 'STANDARD', transaction_limit INT DEFAULT 10000000,
      UNIQUE KEY idx_merchant_apikey (api_key_hash)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL,
      merchant_order_id VARCHAR(255) NOT NULL, provider VARCHAR(50) NOT NULL, provider_reference VARCHAR(255),
      provider_transaction_id VARCHAR(255), payment_method VARCHAR(50) NOT NULL, amount INT NOT NULL,
      total_amount INT NOT NULL, status VARCHAR(20) NOT NULL, customer_name VARCHAR(255),
      customer_email VARCHAR(255), customer_phone VARCHAR(50), description TEXT, payment_code VARCHAR(255),
      payment_url TEXT, qr_string TEXT, instructions_json JSON, expires_at VARCHAR(50),
      paid_at VARCHAR(50), provider_payload_json JSON, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      checkout_token VARCHAR(255), redirect_url TEXT, fee_amount INT DEFAULT 0, net_amount INT DEFAULT 0, fee_snapshot_json JSON,
      UNIQUE KEY idx_merchant_order (merchant_id, merchant_order_id),
      UNIQUE KEY idx_provider_ref (provider_reference),
      UNIQUE KEY idx_checkout_token (checkout_token),
      INDEX idx_payments_status_created (status, created_at),
      CONSTRAINT fk_payments_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS payment_events (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64), provider VARCHAR(50) NOT NULL,
      event_type VARCHAR(50) NOT NULL, signature_valid TINYINT, payload_json JSON NOT NULL,
      created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_events_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64) NOT NULL,
      url TEXT NOT NULL, payload_json JSON NOT NULL, status VARCHAR(20) NOT NULL,
      attempt_count INT NOT NULL DEFAULT 0, response_code INT, last_error TEXT,
      delivered_at VARCHAR(50), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      event_type VARCHAR(50) DEFAULT 'payment.paid', next_attempt_at VARCHAR(50), response_body TEXT, signature VARCHAR(255),
      INDEX idx_deliveries_status (status, updated_at),
      CONSTRAINT fk_deliveries_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id VARCHAR(64) PRIMARY KEY, email VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'viewer',
      is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL, last_login_at VARCHAR(50),
      totp_secret_encrypted TEXT, totp_enabled TINYINT DEFAULT 0,
      locale VARCHAR(10) DEFAULT 'id-ID', timezone VARCHAR(50) DEFAULT 'Asia/Jakarta', username VARCHAR(100),
      UNIQUE KEY idx_admin_email (email)
    );

    CREATE TABLE IF NOT EXISTS identity_tokens (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, purpose VARCHAR(30) NOT NULL,
      token_hash VARCHAR(64) NOT NULL, expires_at VARCHAR(50) NOT NULL, used_at VARCHAR(50), created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_identity_token (token_hash), INDEX idx_identity_user (user_id,purpose,expires_at),
      CONSTRAINT fk_identity_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recovery_codes (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, code_hash VARCHAR(64) NOT NULL,
      used_at VARCHAR(50), created_at VARCHAR(50) NOT NULL, INDEX idx_recovery_user (user_id,used_at),
      CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, token_hash VARCHAR(64) NOT NULL,
      expires_at VARCHAR(50) NOT NULL, used_at VARCHAR(50), requested_ip VARCHAR(50), created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_reset_token (token_hash), INDEX idx_reset_user (user_id, expires_at),
      CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL,
      token_hash VARCHAR(255) NOT NULL, expires_at VARCHAR(50) NOT NULL,
      ip VARCHAR(50), user_agent TEXT, created_at VARCHAR(50) NOT NULL, last_seen_at VARCHAR(50),
      UNIQUE KEY idx_session_token (token_hash),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id VARCHAR(64) PRIMARY KEY, actor_id VARCHAR(64), action VARCHAR(100) NOT NULL,
      target_type VARCHAR(50), target_id VARCHAR(64), ip VARCHAR(50), user_agent TEXT,
      metadata_json JSON, created_at VARCHAR(50) NOT NULL,
      INDEX idx_audit_created (created_at)
    );

    CREATE TABLE IF NOT EXISTS merchant_ip_allowlist (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL,
      cidr VARCHAR(50) NOT NULL, label VARCHAR(100), is_active TINYINT NOT NULL DEFAULT 1,
      created_by VARCHAR(64), last_matched_at VARCHAR(50),
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_ip_merchant_cidr (merchant_id, cidr),
      INDEX idx_ip_allowlist_active (merchant_id, is_active),
      CONSTRAINT fk_ip_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS providers (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL, is_active TINYINT NOT NULL DEFAULT 1,
      priority INT NOT NULL DEFAULT 100, health_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
      last_checked_at VARCHAR(50), metadata_json JSON
    );

    CREATE TABLE IF NOT EXISTS routing_rules (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64), payment_method VARCHAR(50),
      provider VARCHAR(50) NOT NULL, priority INT NOT NULL DEFAULT 100, is_active TINYINT NOT NULL DEFAULT 1,
      created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_attempts (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64) NOT NULL, provider VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL, error TEXT, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fee_rules (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, merchant_id VARCHAR(64),
      provider VARCHAR(50), payment_method VARCHAR(50), fixed_fee INT NOT NULL DEFAULT 0,
      percentage DOUBLE NOT NULL DEFAULT 0, minimum_fee INT NOT NULL DEFAULT 0, maximum_fee INT,
      bearer VARCHAR(20) NOT NULL DEFAULT 'MERCHANT', priority INT NOT NULL DEFAULT 0,
      is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64) NOT NULL, merchant_id VARCHAR(64) NOT NULL,
      amount INT NOT NULL, reason TEXT, status VARCHAR(20) NOT NULL, requested_by VARCHAR(64),
      approved_by VARCHAR(64), provider_reference VARCHAR(255), created_at VARCHAR(50) NOT NULL,
      updated_at VARCHAR(50) NOT NULL, idempotency_key VARCHAR(255),
      UNIQUE KEY idx_refunds_idempotency (idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
      reason TEXT, notes TEXT, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64), code VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL, type VARCHAR(20) NOT NULL, created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_ledger_code (code)
    );

    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id VARCHAR(64) PRIMARY KEY, reference_type VARCHAR(50) NOT NULL, reference_id VARCHAR(64) NOT NULL,
      idempotency_key VARCHAR(255) NOT NULL, description TEXT, created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_ledger_idem (idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id VARCHAR(64) PRIMARY KEY, transaction_id VARCHAR(64) NOT NULL, account_id VARCHAR(64) NOT NULL,
      direction VARCHAR(10) NOT NULL, amount INT NOT NULL, created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_entry_tx FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id),
      CONSTRAINT fk_entry_acc FOREIGN KEY (account_id) REFERENCES ledger_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS payout_destinations (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, type VARCHAR(20) NOT NULL,
      name VARCHAR(100) NOT NULL, account_holder VARCHAR(255) NOT NULL, account_encrypted TEXT NOT NULL,
      account_mask VARCHAR(32) NOT NULL, is_default TINYINT NOT NULL DEFAULT 0, is_active TINYINT NOT NULL DEFAULT 1,
      created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      INDEX idx_payout_merchant (merchant_id, is_active),
      CONSTRAINT fk_payout_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, amount INT NOT NULL,
      status VARCHAR(20) NOT NULL, destination_json JSON, requested_by VARCHAR(64),
      approved_by VARCHAR(64), notes TEXT, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vaulted_payment_methods (
      id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, merchant_id VARCHAR(64) NOT NULL,
      customer_id VARCHAR(64) NOT NULL, provider VARCHAR(50) NOT NULL, provider_token_encrypted TEXT NOT NULL,
      token_fingerprint VARCHAR(64) NOT NULL, method_type VARCHAR(30) NOT NULL, brand VARCHAR(30), display_last4 VARCHAR(4),
      expires_month INT, expires_year INT, consent_at VARCHAR(50) NOT NULL, revoked_at VARCHAR(50), created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_vault_fingerprint (merchant_id,provider,token_fingerprint), INDEX idx_vault_customer (workspace_id,merchant_id,customer_id,revoked_at)
    );

    CREATE TABLE IF NOT EXISTS connected_accounts (
      id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, merchant_id VARCHAR(64) NOT NULL,
      name VARCHAR(160) NOT NULL, external_reference VARCHAR(100), kyc_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      INDEX idx_connected_merchant (merchant_id,status)
    );
    CREATE TABLE IF NOT EXISTS split_rules (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, name VARCHAR(160) NOT NULL, is_active TINYINT NOT NULL DEFAULT 1,
      allocations_json JSON NOT NULL, created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_splits (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64) NOT NULL, rule_id VARCHAR(64), net_amount BIGINT NOT NULL,
      snapshot_json JSON NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'PENDING', created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_payment_split (payment_id)
    );
    CREATE TABLE IF NOT EXISTS split_allocations (
      id VARCHAR(64) PRIMARY KEY, split_id VARCHAR(64) NOT NULL, connected_account_id VARCHAR(64), allocation_type VARCHAR(20) NOT NULL,
      amount BIGINT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'HELD', created_at VARCHAR(50) NOT NULL,
      INDEX idx_split_allocation (split_id,status)
    );

    CREATE TABLE IF NOT EXISTS merchant_reserves (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, amount BIGINT NOT NULL,
      reason VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', release_at VARCHAR(50),
      created_by VARCHAR(64), released_by VARCHAR(64), created_at VARCHAR(50) NOT NULL, released_at VARCHAR(50),
      INDEX idx_reserve_merchant (merchant_id,status,release_at)
    );

    CREATE TABLE IF NOT EXISTS reconciliation_schedules (
      id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, merchant_id VARCHAR(64) NOT NULL,
      frequency VARCHAR(20) NOT NULL, next_run_at VARCHAR(50) NOT NULL, is_active TINYINT NOT NULL DEFAULT 1,
      created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_reconciliation_schedule (merchant_id)
    );

    CREATE TABLE IF NOT EXISTS reconciliation_runs (
      id VARCHAR(64) PRIMARY KEY, provider VARCHAR(50) NOT NULL, status VARCHAR(20) NOT NULL,
      checked_count INT NOT NULL DEFAULT 0, mismatch_count INT NOT NULL DEFAULT 0,
      created_at VARCHAR(50) NOT NULL, completed_at VARCHAR(50)
    );

    CREATE TABLE IF NOT EXISTS reconciliation_items (
      id VARCHAR(64) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, payment_id VARCHAR(64),
      issue_type VARCHAR(50) NOT NULL, local_status VARCHAR(20), provider_status VARCHAR(20),
      details_json JSON, resolution_status VARCHAR(20) NOT NULL DEFAULT 'OPEN', created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_rules (
      id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, event_type VARCHAR(50) NOT NULL,
      channel_ids_json JSON NOT NULL, mute_start VARCHAR(5), mute_end VARCHAR(5), is_active TINYINT NOT NULL DEFAULT 1,
      created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      INDEX idx_notification_rule (workspace_id,event_type,is_active)
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id VARCHAR(64) PRIMARY KEY, type VARCHAR(20) NOT NULL, name VARCHAR(100) NOT NULL,
      config_json JSON NOT NULL, is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_events (
      id VARCHAR(64) PRIMARY KEY, channel_id VARCHAR(64), event_type VARCHAR(50) NOT NULL,
      dedup_key VARCHAR(255), status VARCHAR(20) NOT NULL, payload_json JSON,
      error TEXT, created_at VARCHAR(50) NOT NULL, sent_at VARCHAR(50)
    );

    CREATE TABLE IF NOT EXISTS api_version_usage (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64), api_version VARCHAR(20) NOT NULL,
      method VARCHAR(10) NOT NULL, path VARCHAR(255) NOT NULL, created_at VARCHAR(50) NOT NULL,
      INDEX idx_api_version_usage (api_version,created_at)
    );

    CREATE TABLE IF NOT EXISTS api_nonces (
      merchant_id VARCHAR(64) NOT NULL, nonce VARCHAR(255) NOT NULL,
      expires_at VARCHAR(50) NOT NULL, PRIMARY KEY (merchant_id, nonce)
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      scope VARCHAR(255) NOT NULL, \`key\` VARCHAR(255) NOT NULL,
      request_hash VARCHAR(255) NOT NULL, response_code INT, response_json JSON,
      created_at VARCHAR(50) NOT NULL, expires_at VARCHAR(50) NOT NULL,
      PRIMARY KEY (scope, \`key\`)
    );

    CREATE TABLE IF NOT EXISTS api_credentials (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
      key_prefix VARCHAR(20) NOT NULL, key_hash VARCHAR(255) NOT NULL, secret_encrypted TEXT,
      environment VARCHAR(20) NOT NULL DEFAULT 'live',
      scopes_json JSON NOT NULL,
      expires_at VARCHAR(50), last_used_at VARCHAR(50), revoked_at VARCHAR(50), created_at VARCHAR(50) NOT NULL,
      rotation_parent_id VARCHAR(64), overlap_ends_at VARCHAR(50),
      UNIQUE KEY idx_cred_keyhash (key_hash),
      INDEX idx_cred_merchant_env (merchant_id, environment, revoked_at),
      CONSTRAINT fk_cred_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS merchant_users (
      id VARCHAR(64) PRIMARY KEY, email VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL, is_active TINYINT NOT NULL DEFAULT 1,
      totp_secret_encrypted TEXT, created_at VARCHAR(50) NOT NULL, last_login_at VARCHAR(50),
      UNIQUE KEY idx_mu_email (email)
    );

    CREATE TABLE IF NOT EXISTS merchant_memberships (
      user_id VARCHAR(64) NOT NULL, merchant_id VARCHAR(64) NOT NULL, role VARCHAR(20) NOT NULL,
      created_at VARCHAR(50) NOT NULL, PRIMARY KEY (user_id, merchant_id),
      CONSTRAINT fk_mm_user FOREIGN KEY (user_id) REFERENCES merchant_users(id),
      CONSTRAINT fk_mm_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS payment_links (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, slug VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL, description TEXT, amount INT, allow_custom_amount TINYINT NOT NULL DEFAULT 0,
      min_amount INT, max_amount INT, usage_limit INT, usage_count INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', expires_at VARCHAR(50), redirect_url TEXT,
      metadata_json JSON, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_link_slug (slug),
      CONSTRAINT fk_link_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS approval_policies (
      id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, action_type VARCHAR(50) NOT NULL,
      minimum_amount BIGINT NOT NULL DEFAULT 0, required_approvers INT NOT NULL DEFAULT 1, approver_roles_json JSON NOT NULL,
      distinct_requester TINYINT NOT NULL DEFAULT 1, is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_policy_workspace_action (workspace_id,action_type,minimum_amount), INDEX idx_policy_lookup (workspace_id,action_type,is_active)
    );

    CREATE TABLE IF NOT EXISTS approval_decisions (
      id VARCHAR(64) PRIMARY KEY, approval_id VARCHAR(64) NOT NULL, decided_by VARCHAR(64) NOT NULL,
      decision VARCHAR(20) NOT NULL, notes TEXT, created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_approval_actor (approval_id,decided_by), INDEX idx_approval_decision (approval_id,decision)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id VARCHAR(64) PRIMARY KEY, action_type VARCHAR(50) NOT NULL, target_type VARCHAR(50) NOT NULL,
      target_id VARCHAR(64) NOT NULL, requested_by VARCHAR(64) NOT NULL, approved_by VARCHAR(64),
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING', payload_json JSON, decision_notes TEXT,
      created_at VARCHAR(50) NOT NULL, decided_at VARCHAR(50)
    );

    CREATE TABLE IF NOT EXISTS risk_lists (
      id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, merchant_id VARCHAR(64),
      list_type VARCHAR(10) NOT NULL, subject_type VARCHAR(30) NOT NULL, subject_hash VARCHAR(64) NOT NULL,
      label VARCHAR(255), expires_at VARCHAR(50), created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_risk_list_subject (workspace_id,merchant_id,list_type,subject_type,subject_hash), INDEX idx_risk_list_lookup (workspace_id,merchant_id,subject_type,subject_hash)
    );

    CREATE TABLE IF NOT EXISTS risk_rules (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL, \`signal\` VARCHAR(50) NOT NULL,
      \`operator\` VARCHAR(10) NOT NULL, threshold DOUBLE NOT NULL, window_seconds INT,
      score INT NOT NULL DEFAULT 0, action VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
      is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_events (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64), merchant_id VARCHAR(64) NOT NULL,
      score INT NOT NULL, decision VARCHAR(20) NOT NULL, signals_json JSON NOT NULL,
      review_status VARCHAR(20), reviewed_by VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      INDEX idx_risk_events (merchant_id, created_at)
    );

    CREATE TABLE IF NOT EXISTS provider_circuit_policies (
      provider VARCHAR(50) PRIMARY KEY, failure_threshold INT NOT NULL DEFAULT 5, recovery_seconds INT NOT NULL DEFAULT 60,
      minimum_samples INT NOT NULL DEFAULT 5, degraded_success_rate DOUBLE NOT NULL DEFAULT 90,
      circuit_state VARCHAR(20) NOT NULL DEFAULT 'CLOSED', failure_count INT NOT NULL DEFAULT 0,
      opened_at VARCHAR(50), open_until VARCHAR(50), updated_by VARCHAR(64), updated_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_metrics (
      id VARCHAR(64) PRIMARY KEY, provider VARCHAR(50) NOT NULL, success TINYINT NOT NULL,
      latency_ms INT, error_class VARCHAR(50), created_at VARCHAR(50) NOT NULL,
      INDEX idx_provider_metrics (provider, created_at)
    );

    CREATE TABLE IF NOT EXISTS provider_incidents (
      id VARCHAR(64) PRIMARY KEY, provider VARCHAR(50) NOT NULL, title VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL, severity VARCHAR(20) NOT NULL, message TEXT,
      started_at VARCHAR(50) NOT NULL, resolved_at VARCHAR(50), created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_jobs (
      id VARCHAR(64) PRIMARY KEY, type VARCHAR(50) NOT NULL, payload_json JSON,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING', run_at VARCHAR(50) NOT NULL,
      attempt_count INT NOT NULL DEFAULT 0, lease_owner VARCHAR(64), lease_expires_at VARCHAR(50),
      last_error TEXT, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      INDEX idx_jobs_due (status, run_at)
    );

    CREATE TABLE IF NOT EXISTS onboarding_applications (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL,
      legal_name VARCHAR(255), business_type VARCHAR(50), email_verified_at VARCHAR(50),
      phone_verified_at VARCHAR(50), bank_name VARCHAR(100), bank_account_last4 VARCHAR(4),
      bank_owner_name VARCHAR(255), status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      risk_tier VARCHAR(20) NOT NULL DEFAULT 'STANDARD', reviewer_id VARCHAR(64),
      review_notes TEXT, revision INT NOT NULL DEFAULT 1, submitted_at VARCHAR(50),
      reviewed_at VARCHAR(50), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_onb_merchant (merchant_id),
      INDEX idx_onboarding_status (status, updated_at),
      CONSTRAINT fk_onb_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS kyc_documents (
      id VARCHAR(64) PRIMARY KEY, application_id VARCHAR(64) NOT NULL, document_type VARCHAR(50) NOT NULL,
      file_name VARCHAR(255) NOT NULL, storage_key VARCHAR(255) NOT NULL, checksum VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'UPLOADED', review_notes TEXT, created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_kyc_app FOREIGN KEY (application_id) REFERENCES onboarding_applications(id)
    );

    CREATE TABLE IF NOT EXISTS subscription_plans (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL, monthly_price INT NOT NULL DEFAULT 0,
      limits_json JSON NOT NULL, entitlements_json JSON NOT NULL, is_active TINYINT NOT NULL DEFAULT 1,
      created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_plan_name (name)
    );

    CREATE TABLE IF NOT EXISTS merchant_subscriptions (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL,
      plan_id VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL, trial_ends_at VARCHAR(50),
      current_period_start VARCHAR(50), current_period_end VARCHAR(50), grace_ends_at VARCHAR(50),
      coupon_code VARCHAR(50), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      INDEX idx_sub_merchant (merchant_id, status),
      CONSTRAINT fk_sub_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id),
      CONSTRAINT fk_sub_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
    );

    CREATE TABLE IF NOT EXISTS usage_counters (
      merchant_id VARCHAR(64) NOT NULL, metric VARCHAR(50) NOT NULL, period VARCHAR(20) NOT NULL,
      value INT NOT NULL DEFAULT 0, updated_at VARCHAR(50) NOT NULL,
      PRIMARY KEY (merchant_id, metric, period)
    );

    CREATE TABLE IF NOT EXISTS webhook_attempts (
      id VARCHAR(64) PRIMARY KEY, delivery_id VARCHAR(64) NOT NULL, attempt_number INT NOT NULL,
      response_code INT, response_body TEXT, error TEXT, latency_ms INT NOT NULL DEFAULT 0,
      created_at VARCHAR(50) NOT NULL,
      INDEX idx_webhook_attempts_delivery (delivery_id, created_at),
      CONSTRAINT fk_attempt_delivery FOREIGN KEY (delivery_id) REFERENCES webhook_deliveries(id)
    );

    CREATE TABLE IF NOT EXISTS payment_notes (
      id VARCHAR(64) PRIMARY KEY, payment_id VARCHAR(64) NOT NULL, author_id VARCHAR(64) NOT NULL,
      body TEXT NOT NULL, created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_note_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS saved_filters (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
      resource VARCHAR(50) NOT NULL, filters_json JSON NOT NULL, created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_recovery_codes (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, code_hash VARCHAR(255) NOT NULL,
      used_at VARCHAR(50), created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_admin_recovery_user FOREIGN KEY (user_id) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS in_app_notifications (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64), event_type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL, body TEXT NOT NULL, metadata_json JSON, read_at VARCHAR(50),
      created_at VARCHAR(50) NOT NULL,
      INDEX idx_notifications_user (user_id, read_at, created_at)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, name VARCHAR(255),
      email VARCHAR(255), phone VARCHAR(50), notes TEXT, metadata_json JSON,
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_cust_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, customer_id VARCHAR(64),
      number VARCHAR(50) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      currency VARCHAR(5) NOT NULL DEFAULT 'IDR', subtotal INT NOT NULL DEFAULT 0,
      tax_amount INT NOT NULL DEFAULT 0, discount_amount INT NOT NULL DEFAULT 0,
      total_amount INT NOT NULL DEFAULT 0, due_at VARCHAR(50), description TEXT,
      payment_id VARCHAR(64), portal_token_hash VARCHAR(255),
      sent_at VARCHAR(50), viewed_at VARCHAR(50), paid_at VARCHAR(50),
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_inv_number (merchant_id, number),
      CONSTRAINT fk_inv_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id),
      CONSTRAINT fk_inv_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
      CONSTRAINT fk_inv_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id VARCHAR(64) PRIMARY KEY, invoice_id VARCHAR(64) NOT NULL, name VARCHAR(255) NOT NULL,
      description TEXT, quantity INT NOT NULL, unit_price INT NOT NULL, amount INT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_item_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoice_reminders (
      id VARCHAR(64) PRIMARY KEY, invoice_id VARCHAR(64) NOT NULL, channel VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING', scheduled_at VARCHAR(50) NOT NULL,
      sent_at VARCHAR(50), error TEXT, created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_reminder_inv FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64), code VARCHAR(50) NOT NULL,
      type VARCHAR(20) NOT NULL, value INT NOT NULL, min_amount INT NOT NULL DEFAULT 0,
      max_discount INT, usage_limit INT, usage_count INT NOT NULL DEFAULT 0,
      payment_method VARCHAR(50), starts_at VARCHAR(50), ends_at VARCHAR(50),
      is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_promo_code (merchant_id, code),
      CONSTRAINT fk_promo_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS promotion_redemptions (
      id VARCHAR(64) PRIMARY KEY, promotion_id VARCHAR(64) NOT NULL, payment_id VARCHAR(64),
      customer_id VARCHAR(64), discount_amount INT NOT NULL, created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_redeem_promo FOREIGN KEY (promotion_id) REFERENCES promotions(id),
      CONSTRAINT fk_redeem_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
      CONSTRAINT fk_redeem_cust FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS customer_portal_sessions (
      id VARCHAR(64) PRIMARY KEY, customer_id VARCHAR(64) NOT NULL,
      token_hash VARCHAR(255) NOT NULL, expires_at VARCHAR(50) NOT NULL,
      last_used_at VARCHAR(50), created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_portal_token (token_hash),
      CONSTRAINT fk_portal_cust FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS payment_link_visits (
      id VARCHAR(64) PRIMARY KEY, link_id VARCHAR(64) NOT NULL, session_hash VARCHAR(255),
      converted_payment_id VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_visit_link FOREIGN KEY (link_id) REFERENCES payment_links(id),
      CONSTRAINT fk_visit_payment FOREIGN KEY (converted_payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS recurring_plans (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, name VARCHAR(255) NOT NULL,
      amount INT NOT NULL, interval_unit VARCHAR(20) NOT NULL, interval_count INT NOT NULL DEFAULT 1,
      trial_days INT NOT NULL DEFAULT 0, retry_limit INT NOT NULL DEFAULT 3,
      is_active TINYINT NOT NULL DEFAULT 1, created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_rp_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS recurring_subscriptions (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, plan_id VARCHAR(64) NOT NULL,
      customer_id VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
      provider_token_encrypted TEXT, current_period_start VARCHAR(50), current_period_end VARCHAR(50),
      next_charge_at VARCHAR(50), retry_count INT NOT NULL DEFAULT 0,
      cancel_at_period_end TINYINT NOT NULL DEFAULT 0, paused_at VARCHAR(50), cancelled_at VARCHAR(50),
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_rs_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id),
      CONSTRAINT fk_rs_plan FOREIGN KEY (plan_id) REFERENCES recurring_plans(id),
      CONSTRAINT fk_rs_cust FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS billing_cycles (
      id VARCHAR(64) PRIMARY KEY, subscription_id VARCHAR(64) NOT NULL,
      period_start VARCHAR(50) NOT NULL, period_end VARCHAR(50) NOT NULL,
      amount INT NOT NULL, status VARCHAR(20) NOT NULL, payment_id VARCHAR(64),
      attempt_count INT NOT NULL DEFAULT 0, last_error TEXT,
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_bc_sub_period (subscription_id, period_start),
      CONSTRAINT fk_bc_sub FOREIGN KEY (subscription_id) REFERENCES recurring_subscriptions(id),
      CONSTRAINT fk_bc_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS saved_reports (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, merchant_id VARCHAR(64),
      name VARCHAR(255) NOT NULL, resource VARCHAR(50) NOT NULL, filters_json JSON NOT NULL,
      columns_json JSON NOT NULL, schedule_cron VARCHAR(50), is_active TINYINT NOT NULL DEFAULT 1,
      last_run_at VARCHAR(50), next_run_at VARCHAR(50), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES admin_users(id),
      CONSTRAINT fk_report_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS report_runs (
      id VARCHAR(64) PRIMARY KEY, report_id VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
      row_count INT NOT NULL DEFAULT 0, output_json JSON, error TEXT,
      created_at VARCHAR(50) NOT NULL, completed_at VARCHAR(50),
      CONSTRAINT fk_rr_report FOREIGN KEY (report_id) REFERENCES saved_reports(id)
    );

    CREATE TABLE IF NOT EXISTS reconciliation_imports (
      id VARCHAR(64) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, file_name VARCHAR(255) NOT NULL,
      checksum VARCHAR(255) NOT NULL, row_count INT NOT NULL, created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_ri_run FOREIGN KEY (run_id) REFERENCES reconciliation_runs(id)
    );

    CREATE TABLE IF NOT EXISTS provider_route_configs (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64), payment_method VARCHAR(50),
      provider VARCHAR(50) NOT NULL, priority INT NOT NULL DEFAULT 100, weight INT NOT NULL DEFAULT 100,
      min_amount INT, max_amount INT, is_active TINYINT NOT NULL DEFAULT 1,
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_prc_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS incident_updates (
      id VARCHAR(64) PRIMARY KEY, incident_id VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
      message TEXT NOT NULL, created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_iu_incident FOREIGN KEY (incident_id) REFERENCES provider_incidents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dispute_evidence (
      id VARCHAR(64) PRIMARY KEY, dispute_id VARCHAR(64) NOT NULL, type VARCHAR(50) NOT NULL,
      file_name VARCHAR(255), storage_key VARCHAR(255), content TEXT, checksum VARCHAR(255),
      created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_de_dispute FOREIGN KEY (dispute_id) REFERENCES disputes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dispute_events (
      id VARCHAR(64) PRIMARY KEY, dispute_id VARCHAR(64) NOT NULL, from_status VARCHAR(20),
      to_status VARCHAR(20) NOT NULL, notes TEXT, actor_id VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_dev_dispute FOREIGN KEY (dispute_id) REFERENCES disputes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sandbox_sessions (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
      scenario VARCHAR(50) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by VARCHAR(64), expires_at VARCHAR(50), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_ss_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS sandbox_events (
      id VARCHAR(64) PRIMARY KEY, session_id VARCHAR(64) NOT NULL, event_type VARCHAR(50) NOT NULL,
      payload_json JSON NOT NULL, sequence INT NOT NULL, created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_se_session_seq (session_id, sequence),
      CONSTRAINT fk_se_session FOREIGN KEY (session_id) REFERENCES sandbox_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS webhook_playground_events (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) NOT NULL, event_type VARCHAR(50) NOT NULL,
      url TEXT NOT NULL, payload_json JSON NOT NULL, headers_json JSON NOT NULL,
      response_code INT, response_body TEXT, status VARCHAR(20) NOT NULL,
      created_by VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_wpe_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS retention_policies (
      id VARCHAR(64) PRIMARY KEY, resource VARCHAR(50) NOT NULL, retention_days INT NOT NULL,
      action VARCHAR(20) NOT NULL DEFAULT 'DELETE', is_active TINYINT NOT NULL DEFAULT 1,
      legal_hold TINYINT NOT NULL DEFAULT 0, updated_by VARCHAR(64),
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_retention_resource (resource)
    );

    CREATE TABLE IF NOT EXISTS audit_exports (
      id VARCHAR(64) PRIMARY KEY, requested_by VARCHAR(64) NOT NULL, filters_json JSON NOT NULL,
      row_count INT NOT NULL, format VARCHAR(10) NOT NULL, checksum VARCHAR(255) NOT NULL,
      content LONGTEXT NOT NULL, created_at VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compliance_assessments (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64), framework VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL, score INT NOT NULL, checks_json JSON NOT NULL,
      assessed_by VARCHAR(64), created_at VARCHAR(50) NOT NULL,
      CONSTRAINT fk_ca_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS onboarding_checks (
      id VARCHAR(64) PRIMARY KEY, application_id VARCHAR(64) NOT NULL, check_type VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL, result_json JSON NOT NULL, created_at VARCHAR(50) NOT NULL,
      UNIQUE KEY idx_oc_app_type (application_id, check_type),
      CONSTRAINT fk_oc_app FOREIGN KEY (application_id) REFERENCES onboarding_applications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inspection_tickets (
      id VARCHAR(64) PRIMARY KEY, merchant_id VARCHAR(64) CHARACTER SET utf8mb3 NOT NULL, payment_id VARCHAR(64), dispute_id VARCHAR(64), webhook_delivery_id VARCHAR(64),
      title VARCHAR(160) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'OPEN', priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL', notes TEXT,
      created_by VARCHAR(64), assigned_to VARCHAR(64), created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      INDEX idx_ticket_merchant (merchant_id, updated_at), CONSTRAINT fk_ticket_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );

    CREATE TABLE IF NOT EXISTS merchant_payment_methods (
      merchant_id VARCHAR(64) NOT NULL, payment_method VARCHAR(50) NOT NULL,
      is_enabled TINYINT NOT NULL DEFAULT 0, fee_bearer VARCHAR(20) NOT NULL DEFAULT 'MERCHANT',
      created_at VARCHAR(50) NOT NULL, updated_at VARCHAR(50) NOT NULL,
      admin_fee_fixed INT NOT NULL DEFAULT 0, admin_fee_percentage DOUBLE NOT NULL DEFAULT 0,
      settlement_label VARCHAR(255) NOT NULL DEFAULT 'Sesuai akun Tokopay',
      minimum_amount INT NOT NULL DEFAULT 1000, maximum_amount INT,
      PRIMARY KEY (merchant_id, payment_method),
      INDEX idx_mpm_enabled (merchant_id, is_enabled),
      CONSTRAINT fk_mpm_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
    );
  `);

  /* ── Workspace migration (idempotent; legacy data remains available in one default tenant) ── */
  const hasColumn=async(table,column)=>Boolean(await db.get('SELECT 1 found FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]));
  if(!await hasColumn('merchants','workspace_id'))await db.exec('ALTER TABLE merchants ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD INDEX idx_merchant_workspace (workspace_id,created_at)');
  if(!await hasColumn('admin_sessions','active_workspace_id'))await db.exec('ALTER TABLE admin_sessions ADD COLUMN active_workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL');
  if(!await hasColumn('admin_users','email_verified_at'))await db.exec('ALTER TABLE admin_users ADD COLUMN email_verified_at VARCHAR(50) NULL');
  if(!await hasColumn('admin_sessions','step_up_at'))await db.exec('ALTER TABLE admin_sessions ADD COLUMN step_up_at VARCHAR(50) NULL');
  if(!await hasColumn('merchants','production_activated_at'))await db.exec('ALTER TABLE merchants ADD COLUMN production_activated_at VARCHAR(50) NULL');
  if(!await hasColumn('onboarding_applications','workspace_id'))await db.exec('ALTER TABLE onboarding_applications ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD INDEX idx_onb_workspace (workspace_id,status,updated_at)');
  if(!await hasColumn('onboarding_applications','registration_number'))await db.exec('ALTER TABLE onboarding_applications ADD COLUMN registration_number VARCHAR(100) NULL, ADD COLUMN tax_number VARCHAR(100) NULL, ADD COLUMN business_address TEXT NULL, ADD COLUMN website VARCHAR(255) NULL, ADD COLUMN rejection_reason TEXT NULL');
  if(!await hasColumn('onboarding_applications','beneficial_owners_json'))await db.exec('ALTER TABLE onboarding_applications ADD COLUMN beneficial_owners_json JSON NULL');
  if(!await hasColumn('approvals','workspace_id'))await db.exec('ALTER TABLE approvals ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD COLUMN merchant_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD COLUMN amount BIGINT NOT NULL DEFAULT 0, ADD COLUMN required_approvers INT NOT NULL DEFAULT 1, ADD COLUMN approved_count INT NOT NULL DEFAULT 0, ADD INDEX idx_approval_workspace (workspace_id,status,created_at)');
  if(!await hasColumn('disputes','provider_case_id'))await db.exec("ALTER TABLE disputes ADD COLUMN provider_case_id VARCHAR(100) NULL, ADD COLUMN reason_code VARCHAR(50) NULL, ADD COLUMN disputed_amount BIGINT NULL, ADD COLUMN response_due_at VARCHAR(50) NULL, ADD COLUMN assigned_to VARCHAR(64) NULL, ADD COLUMN response_template TEXT NULL, ADD COLUMN sla_status VARCHAR(20) NOT NULL DEFAULT 'ON_TRACK', ADD INDEX idx_dispute_deadline (status,response_due_at)");
  if(!await hasColumn('dispute_evidence','checklist_item'))await db.exec("ALTER TABLE dispute_evidence ADD COLUMN checklist_item VARCHAR(100) NULL, ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED'");
  if(!await hasColumn('risk_rules','workspace_id'))await db.exec('ALTER TABLE risk_rules ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD COLUMN merchant_id VARCHAR(64) NULL, ADD COLUMN description TEXT NULL, ADD COLUMN priority INT NOT NULL DEFAULT 100, ADD INDEX idx_risk_rule_scope (workspace_id,merchant_id,is_active,priority)');
  if(!await hasColumn('ledger_transactions','entry_hash'))await db.exec('ALTER TABLE ledger_transactions ADD COLUMN entry_hash VARCHAR(64) NULL, ADD COLUMN posted_at VARCHAR(50) NULL');
  if(!await hasColumn('provider_metrics','operation'))await db.exec('ALTER TABLE provider_metrics ADD COLUMN operation VARCHAR(50) NULL, ADD COLUMN http_status INT NULL');
  if(!await hasColumn('notification_channels','workspace_id'))await db.exec('ALTER TABLE notification_channels ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD COLUMN updated_at VARCHAR(50) NULL, ADD INDEX idx_notification_channel_scope (workspace_id,is_active)');
  if(!await hasColumn('retention_policies','workspace_id'))await db.exec('ALTER TABLE retention_policies ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, DROP INDEX idx_retention_resource, ADD UNIQUE KEY idx_retention_scope (workspace_id,resource)');
  if(!await hasColumn('audit_exports','manifest_json'))await db.exec('ALTER TABLE audit_exports ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD COLUMN manifest_json JSON NULL');
  if(!await hasColumn('webhook_deliveries','replay_of'))await db.exec('ALTER TABLE webhook_deliveries ADD COLUMN replay_of VARCHAR(64) NULL, ADD COLUMN replay_reason VARCHAR(255) NULL');
  if(!await hasColumn('merchants','webhook_secret_previous'))await db.exec('ALTER TABLE merchants ADD COLUMN webhook_secret_previous VARCHAR(255) NULL, ADD COLUMN webhook_secret_overlap_ends_at VARCHAR(50) NULL');
  if(!await hasColumn('notification_events','attempt_count'))await db.exec('ALTER TABLE notification_events ADD COLUMN attempt_count INT NOT NULL DEFAULT 0, ADD COLUMN next_retry_at VARCHAR(50) NULL, ADD COLUMN response_status INT NULL');
  if(!await hasColumn('recurring_plans','grace_days'))await db.exec("ALTER TABLE recurring_plans ADD COLUMN grace_days INT NOT NULL DEFAULT 3, ADD COLUMN retry_interval_hours INT NOT NULL DEFAULT 24, ADD COLUMN proration_policy VARCHAR(20) NOT NULL DEFAULT 'NONE'");
  if(!await hasColumn('recurring_subscriptions','vault_method_id'))await db.exec('ALTER TABLE recurring_subscriptions ADD COLUMN vault_method_id VARCHAR(64) NULL, ADD COLUMN payment_link_id VARCHAR(64) NULL');
  if(!await hasColumn('billing_cycles','payment_id'))await db.exec('ALTER TABLE billing_cycles ADD COLUMN payment_id VARCHAR(64) NULL, ADD COLUMN idempotency_key VARCHAR(160) NULL, ADD COLUMN next_retry_at VARCHAR(50) NULL, ADD COLUMN failure_reason TEXT NULL, ADD UNIQUE KEY idx_billing_cycle_period (subscription_id,period_start)');
  if(!await hasColumn('provider_incidents','public_message'))await db.exec('ALTER TABLE provider_incidents ADD COLUMN public_message TEXT NULL, ADD COLUMN affected_methods_json JSON NULL, ADD COLUMN public_status TINYINT NOT NULL DEFAULT 0, ADD COLUMN updated_at VARCHAR(50) NULL');
  if(!await hasColumn('reconciliation_runs','merchant_id'))await db.exec('ALTER TABLE reconciliation_runs ADD COLUMN merchant_id VARCHAR(64) NULL, ADD COLUMN workspace_id VARCHAR(64) CHARACTER SET utf8mb3 NULL, ADD COLUMN triggered_by VARCHAR(64) NULL, ADD INDEX idx_rec_scope (workspace_id,merchant_id,created_at)');
  if(!await hasColumn('reconciliation_items','assigned_to'))await db.exec('ALTER TABLE reconciliation_items ADD COLUMN assigned_to VARCHAR(64) NULL, ADD COLUMN resolution_notes TEXT NULL, ADD COLUMN resolved_by VARCHAR(64) NULL, ADD COLUMN resolved_at VARCHAR(50) NULL');
  await db.exec("UPDATE risk_rules SET workspace_id='ws_legacy_default' WHERE workspace_id IS NULL");
  await db.exec("UPDATE approvals a LEFT JOIN merchants m ON m.id=a.merchant_id SET a.workspace_id=COALESCE(m.workspace_id,'ws_legacy_default') WHERE a.workspace_id IS NULL");
  const policyWorkspaceRows=await db.all('SELECT id FROM workspaces');for(const workspace of policyWorkspaceRows)for(const [action,amount,count,roles] of [['SETTLEMENT',0,1,['owner','finance']],['REFUND',1000000,1,['owner','finance']],['PAYOUT_DESTINATION',0,1,['owner']],['API_KEY_ROTATION',0,1,['owner','developer']]])await db.run('INSERT IGNORE INTO approval_policies (id,workspace_id,action_type,minimum_amount,required_approvers,approver_roles_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[id('apol'),workspace.id,action,amount,count,JSON.stringify(roles),now(),now()]);
  await db.exec('UPDATE onboarding_applications o JOIN merchants m ON m.id=o.merchant_id SET o.workspace_id=m.workspace_id WHERE o.workspace_id IS NULL');
  const legacyWorkspace='ws_legacy_default',stamp=now();
  await db.run('INSERT IGNORE INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)',[legacyWorkspace,'EvoPay Legacy Workspace','legacy',stamp,stamp]);
  await db.run('UPDATE merchants SET workspace_id=? WHERE workspace_id IS NULL',[legacyWorkspace]);

  /* ── Seed admin ── */
  const adminExists = await db.get('SELECT id, username FROM admin_users LIMIT 1');
  if (!adminExists && process.env.ADMIN_PASSWORD) {
    await db.run(
      'INSERT INTO admin_users (id,email,name,username,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)',
      [id('usr'), process.env.ADMIN_EMAIL || 'admin@evopay.local', 'EvoPay Admin', process.env.ADMIN_USERNAME || 'admin', hashPassword(process.env.ADMIN_PASSWORD), 'owner', now()]
    );
  }
  if (adminExists && !adminExists.username) {
    await db.run('UPDATE admin_users SET username=? WHERE id=?', [process.env.ADMIN_USERNAME || 'admin', adminExists.id]);
  }
  const legacyUsers=await db.all('SELECT id,role FROM admin_users');
  for(const user of legacyUsers)await db.run('INSERT IGNORE INTO workspace_members (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)',[legacyWorkspace,user.id,user.role,now()]);
  await db.run('UPDATE admin_sessions SET active_workspace_id=? WHERE active_workspace_id IS NULL',[legacyWorkspace]);

  /* ── Seed demo merchant (non-production) ── */
  const demoKey = process.env.DEMO_MERCHANT_API_KEY || 'np_demo_topup_please_change';
  const demoExists = await db.get('SELECT id FROM merchants WHERE id = ?', ['m_demo_topup']);
  if (process.env.NODE_ENV !== 'production' && !demoExists) {
    await db.run(
      'INSERT INTO merchants (id,name,api_key_hash,callback_url,created_at,workspace_id) VALUES (?,?,?,?,?,?)',
      ['m_demo_topup', 'Demo Topup Store', hashApiKey(demoKey), null, now(), legacyWorkspace]
    );
  }

  console.log('MySQL schema initialized.');
}

/* ── Helper exports ── */
export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex');
export const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
export const verifyPassword = (password, stored = '') => { const [salt, expected] = stored.split(':'); if (!salt || !expected) return false; const actual = crypto.scryptSync(password, salt, 64); const target = Buffer.from(expected, 'hex'); return target.length === actual.length && crypto.timingSafeEqual(target, actual); };

export default db;
