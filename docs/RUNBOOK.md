# EvoPay Recovery Runbook

Gunakan dokumen ini saat operasional gateway terganggu. Simpan waktu mulai insiden, `x-request-id`, payment ID, Site ID, dan callback delivery ID sebelum mengubah konfigurasi.

> [!CAUTION]
> Jangan menghapus data, melakukan restore in-place ke database produksi, atau replay callback sebelum handler Site memakai `x-evopay-delivery` sebagai idempotency key.

## Triage awal — 60 detik

```bash
curl -i "$EVOPAY_URL/health/live"
curl -i "$EVOPAY_URL/health/ready"
curl -sS -H "Authorization: Bearer $OBSERVABILITY_TOKEN" "$EVOPAY_URL/internal/metrics"
npm run db:verify
```

| Sinyal | Makna | Tindakan awal |
|---|---|---|
| `/health/live` gagal | Process/app down | Periksa service process dan log; jangan mengubah database dulu. |
| `/health/ready` 503 database error | MySQL/config tidak siap | Ikuti [Database down](#database-down). |
| `/health/ready` 503 provider missing | Credential Tokopay tidak lengkap | Ikuti [Rotasi credential](#rotasi-credential). |
| Callback dead-letter > 0 | Callback Site butuh tindakan | Ikuti [Callback Site gagal](#callback-site-gagal). |
| Banyak payment `PENDING` | Provider/webhook delay | Ikuti [Tokopay lambat](#tokopay-lambat-atau-tidak-tersedia). |

## Callback Site gagal

1. Buka **Webhook monitor** dan pilih delivery.
2. `RETRYING` masih dicoba otomatis; perbaiki endpoint Site. `DEAD_LETTER` memerlukan inspeksi dan replay manual.
3. Periksa HTTP status, latency, dan response preview. Jangan masukkan webhook secret ke log/issue.
4. Perbaiki callback Site: URL publik HTTPS, TLS valid, response `2xx` cepat, handler idempotent.
5. Dari **Sites & API Keys**, jalankan **Test webhook** untuk memverifikasi signature HMAC dan endpoint.
6. Jika test delivered, replay delivery dead-letter dari Webhook monitor.
7. Pastikan status `DELIVERED` dan Site tidak fulfill order dua kali.

> [!IMPORTANT]
> Replay mengirim payload payment yang sama. Handler Site wajib deduplicate dengan header `x-evopay-delivery`.

## Tokopay lambat atau tidak tersedia

1. Cek `/health/ready`, structured log, dan status dashboard Tokopay bila tersedia.
2. Jika create payment timeout/gagal, aktifkan **Maintenance Mode** Site terdampak. Create baru mendapat `503`; payment existing tetap berjalan.
3. Jangan menandai payment `FAILED` hanya karena timeout/delay.
4. Setelah provider pulih, jalankan **Rekonsiliasi** satu batch dan tinjau `fixed`/`errors`.
5. Jalankan satu test payment kecil atau Site TEST dahulu.
6. Nonaktifkan Maintenance Mode setelah create dan callback normal.

## Database down

1. Pastikan dampak dengan `/health/live` dan `/health/ready`.
2. Periksa MySQL service, disk, connection limit, serta `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` deployment.
3. Setelah koneksi pulih:

```bash
npm run db:verify
curl -i "$EVOPAY_URL/health/ready"
```

4. Bila verification gagal, jangan restart loop aplikasi. Periksa error MySQL dan backup terbaru.
5. Setelah readiness `200`, periksa backlog lalu buat payment Site TEST untuk smoke test sebelum membuka Site LIVE.

## Backup dan restore database

> [!CAUTION]
> **Jangan restore di atas database produksi aktif.** Restore selalu ke database baru, verifikasi, lalu cutover terkontrol. Siapkan rollback ke database lama.

### Buat backup sebelum tindakan

```bash
npm run db:backup -- backups/evopay-pre-restore-$(date +%Y%m%d-%H%M%S).sql
shasum -a 256 backups/FILE.sql
cat backups/FILE.sql.json
```

Hash terminal harus sama dengan `sha256` pada sidecar.

### Restore aman ke database baru

1. Aktifkan Maintenance Mode untuk semua Site LIVE.
2. Buat database target baru, contoh `evopay_restore_20260825`.
3. Restore dump:

```bash
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p -e 'CREATE DATABASE evopay_restore_20260825 CHARACTER SET utf8mb4;'
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p evopay_restore_20260825 < backups/FILE.sql
```

4. Arahkan **staging/instance terpisah** ke `DB_NAME=evopay_restore_20260825`.
5. Jalankan `npm run db:verify`, `npm test`, dan `curl -i "$EVOPAY_URL/health/ready"`.
6. Periksa jumlah payment/Site, dashboard, dan callback sebelum cutover.
7. Cutover hanya setelah seluruh check lulus. Bila gagal, kembali ke DB original; jangan restore ulang DB original.
8. Setelah cutover, test Site TEST dan callback monitor sebelum nonaktifkan maintenance.

## Rotasi credential

### API key Site

1. Dashboard → **Sites & API Keys** → rotasi API key.
2. Simpan key baru di secret manager/environment backend Site dan deploy.
3. Test `GET /api/v1/payment-methods` dengan key baru.
4. Key lama tidak lagi berlaku; pastikan semua deployment Site sudah memakai key baru.

### Webhook secret Site

Belum ada endpoint rotate webhook secret khusus. Jalur aman: buat Site pengganti, deploy API key/secret baru, jalankan **Test webhook**, migrasikan integration, cek callback pending Site lama, lalu nonaktifkan Site lama.

### Tokopay secret

Masukkan credential baru di secret manager, deploy/restart terkontrol, cek `/health/ready` dan Site TEST/payment kecil, lalu monitor webhook/reconciliation selama 15 menit.

### Admin password dan observability token

Ganti admin password dari dashboard. Untuk `OBSERVABILITY_TOKEN`, update environment deployment, restart terkontrol, lalu update monitoring collector segera.

## Post-incident checklist

- [ ] `/health/live` dan `/health/ready` adalah `200`.
- [ ] Callback retrying/dead-letter kembali baseline.
- [ ] Rekonsiliasi terakhir tidak memiliki error belum ditindak.
- [ ] Expiry backlog masuk akal/kosong.
- [ ] Maintenance Mode sesuai kondisi deployment.
- [ ] API usage limit tidak menolak traffic normal.
- [ ] Audit Log mencatat perubahan manual selama insiden.
- [ ] Catat penyebab, waktu pulih, dan tindak lanjut.

## Structured Alerts

Mulai triage dari dashboard **Alerts**. Alert dihitung langsung dari kondisi gateway dan hilang setelah sumber masalah pulih; tidak perlu di-acknowledge. Buka action yang tersedia, lakukan tindakan sesuai section runbook, lalu Refresh Alerts untuk konfirmasi recovery.
