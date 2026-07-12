# NexusPay Production Runbook

## Deployment topology

- Run Node.js 20+ as a non-root user behind an HTTPS reverse proxy.
- This SQLite build is **single-instance only**. Do not run multiple replicas against one database volume.
- Mount `DATABASE_PATH` on persistent local/block storage; do not use ephemeral or shared network storage.
- Set `TRUST_PROXY=1` only when the direct upstream is a trusted reverse proxy that replaces forwarded headers.

## Required environment

Set `NODE_ENV=production`, an HTTPS `APP_BASE_URL`, persistent `DATABASE_PATH`, unique `ADMIN_PASSWORD` (14+ chars), random `ENCRYPTION_KEY` (32+ chars), Tokopay credentials, `SIMULATOR_ENABLED=0`, and explicit `TRUST_PROXY=0|1`. Startup fails fast if these controls are missing.

## Before deployment

1. Run `npm ci --omit=dev` on the target artifact.
2. Run `npm run check:production` in CI.
3. Back up the SQLite database and verify restore on a separate path.
4. Configure TLS, request body limits, and access logs at the reverse proxy.
5. Restrict database directory permissions to the service account.
6. Store secrets in the platform secret manager, never in the image or repository.

## Health and shutdown

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Send `SIGTERM`; allow at least 10 seconds for HTTP drain and WAL checkpoint.

## Backup and restore

Use SQLite online backup or `VACUUM INTO` while the service is healthy. Retain encrypted daily backups and test restores regularly. Stop the replacement service before swapping database files; preserve the `.db`, `-wal`, and `-shm` set if copying without an online backup.

## Post-deploy smoke test

1. Check readiness and security headers.
2. Login/logout admin over HTTPS.
3. Create a sandbox/staging merchant and rotate its key.
4. Validate allowed and denied Whitelist IP requests.
5. Create a simulator payment only in staging.
6. Validate webhook signature, retry, refund, ledger, and settlement flows.
7. Inspect audit logs and ensure no secret appears in logs.

## Rollback

Stop traffic, send `SIGTERM`, restore the last compatible application artifact and database backup, then verify `/health/ready`. Never downgrade across an incompatible schema without a tested migration rollback.
