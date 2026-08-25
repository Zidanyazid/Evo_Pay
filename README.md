# EvoPay Personal Gateway

EvoPay adalah gateway pribadi untuk menghubungkan banyak website Anda ke satu akun Tokopay.

```text
Website Anda → EvoPay API → Tokopay
Tokopay webhook → EvoPay → callback signed ke website Anda
```

EvoPay tidak menyimpan saldo, tidak melakukan settlement/payout, dan tidak memproses refund. Dana dan alur settlement tetap berada di Tokopay.

## Jalankan lokal

```bash
cp .env.example .env
npm install
npm run dev
```

Buka `http://localhost:3000`, masuk memakai `ADMIN_PASSWORD`, lalu buat satu **Site** untuk tiap website. API key Site hanya tampil saat dibuat atau dirotasi.

## API payment

```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H 'Authorization: Bearer API_KEY_SITE' \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"TOPUP-10001","amount":15000,"payment_method":"QRIS"}'
```

- `GET /api/v1/payment-methods`
- `POST /api/v1/payments`
- `GET /api/v1/payments/:id`
- `POST /api/v1/payments/:id/sync`

Tokopay callback harus diarahkan ke `https://domain-anda/webhooks/tokopay`.

## Callback ke Site

Saat status menjadi `PAID`, EvoPay mengirim POST JSON ke callback URL Site:

```json
{"event":"payment.paid","data":{"id":"pay_...","order_id":"TOPUP-10001","status":"PAID"}}
```

Header `x-evopay-signature` berbentuk `sha256=<HMAC SHA-256 payload>`. Verifikasi signature menggunakan `webhook_secret` yang ditampilkan saat Site dibuat. Callback di-retry dan dapat dikirim ulang dari dashboard bila dead-letter.

## Produksi

- Gunakan HTTPS dan `APP_BASE_URL` publik.
- Isi `TOKOPAY_MERCHANT_ID` dan `TOKOPAY_SECRET`.
- Set `SIMULATOR_ENABLED=0`.
- Gunakan user MySQL khusus aplikasi, bukan `root`.
- Simpan `.env`, dump `backups/`, serta API key di luar Git.

## Validasi

```bash
npm test
npm run check:syntax
npm audit --omit=dev --audit-level=high
```

## Observability

- `GET /health/live`: process liveness probe.
- `GET /health/ready`: database and Tokopay configuration readiness probe.
- `GET /internal/metrics`: private Prometheus text metrics. Send `Authorization: Bearer $OBSERVABILITY_TOKEN`.

```bash
curl -H "Authorization: Bearer $OBSERVABILITY_TOKEN" http://localhost:3000/internal/metrics
```

Alert minimum: readiness non-200, `evopay_callback_dead_letter > 0`, atau reconciliation run memiliki error.

## Payment expiration

Worker memindahkan payment `LIVE` berstatus `PENDING` ke `EXPIRED` bila `expires_at` dari Tokopay sudah lewat. Payment tanpa expiry dan Site `TEST` tidak disentuh. Tidak ada callback expiry karena EvoPay saat ini hanya memiliki event `payment.paid`.

```bash
# optional tuning
PAYMENT_EXPIRATION_INTERVAL_MS=60000
PAYMENT_EXPIRATION_BATCH_SIZE=100
```

## Site maintenance mode

Aktifkan maintenance per Site dari dashboard saat deploy. EvoPay menolak `POST /api/v1/payments` dengan `503 SITE_MAINTENANCE` dan header `Retry-After: 300`. Jangan loop request create; tampilkan pesan sementara lalu retry setelah maintenance selesai. Get/sync payment existing, Tokopay webhook, dan callback delivery tetap berjalan.

## API usage limit per Site

EvoPay menerapkan fixed-window 60 detik per Site: create payment default `30/menit`, sync default `60/menit`. Set override dari **Usage limits** pada Site card. Saat limit tercapai, client menerima `429 RATE_LIMITED`, `Retry-After`, dan header `X-RateLimit-*`; gunakan backoff sampai window berikutnya.

```env
SITE_CREATE_PAYMENT_LIMIT_PER_MINUTE=30
SITE_SYNC_PAYMENT_LIMIT_PER_MINUTE=60
```

## Recovery Runbook

Emergency checklist: cek `/health/ready`; aktifkan Site Maintenance bila create traffic harus dihentikan; periksa callback/reconciliation backlog; lalu ikuti [Recovery Runbook](docs/RUNBOOK.md). Jangan restore database produksi in-place.

## Structured Alerts

Dashboard **Alerts** menyatukan kondisi yang membutuhkan tindakan: callback dead-letter/retry, error atau keterlambatan rekonsiliasi, expiry backlog, maintenance lebih dari 30 menit, dan usage quota Site ≥80%. Alert dihitung dari state operasional saat halaman dimuat dan hilang otomatis saat kondisi pulih. Alert tidak mengeksekusi recovery otomatis; gunakan action link untuk menuju Webhook monitor, Rekonsiliasi, Recovery Center, atau Sites.
