# NexusPay Gateway

Gateway pembayaran **self-hosted** untuk banyak website topup. Website mengakses API NexusPay; NexusPay meneruskan transaksi ke Tokopay. Kredensial Tokopay tidak pernah dikirim ke browser atau merchant website.

## Mulai lokal

```bash
cp .env.example .env
npm install
npm run dev
```

Buka `http://localhost:3000`. Password dashboard awal ada di `ADMIN_PASSWORD` dalam `.env`. Ganti sebelum dipakai. Merchant demo tersedia hanya untuk pengujian lokal:

```text
Authorization: Bearer np_demo_topup_please_change
```

> Ganti atau hapus key demo sebelum deployment.

## Konfigurasi Tokopay

Isi file `.env` dengan kredensial Anda, lalu restart server:

```env
APP_BASE_URL=https://gateway.domain-anda.com
TOKOPAY_MERCHANT_ID=...
TOKOPAY_SECRET=...
TOKOPAY_WEBHOOK_IPS=178.128.104.179
```

Atur callback di Tokopay menjadi `https://gateway.domain-anda.com/webhooks/tokopay`. Endpoint memeriksa signature sebelum memperbarui transaksi dan selalu membalas `{"status":true}` agar sesuai callback Tokopay.

## API untuk website topup

### Buat pembayaran

```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H 'Authorization: Bearer API_KEY_MERCHANT' \
  -H 'Content-Type: application/json' \
  -d '{
    "order_id":"TOPUP-10001",
    "amount":15000,
    "payment_method":"qris",
    "customer":{"name":"Zidan","email":"zidan@example.com"},
    "description":"Topup game",
    "redirect_url":"https://topup-anda.com/order/TOPUP-10001"
  }'
```

Simpan `data.id` dari respons. Jika `order_id` yang sama dikirim ulang untuk merchant sama, gateway mengembalikan transaksi lama (`duplicate: true`) — aman untuk retry dari website.

### Cek atau sinkronkan status

```bash
curl -H 'Authorization: Bearer API_KEY_MERCHANT' \
  http://localhost:3000/api/v1/payments/PAYMENT_ID

curl -X POST -H 'Authorization: Bearer API_KEY_MERCHANT' \
  http://localhost:3000/api/v1/payments/PAYMENT_ID/sync
```

### Callback ke merchant

Saat pembayaran menjadi `PAID`, NexusPay mengirim `POST` JSON ke URL callback yang disimpan pada merchant. Payload berbentuk:

```json
{ "event": "payment.paid", "data": { "id": "pay_...", "order_id": "TOPUP-10001", "status": "PAID" } }
```

Produk topup **hanya boleh diproses** setelah menerima status `PAID` dan setelah melakukan pengecekan idempotensi di aplikasi Anda.

## Manajemen merchant

Buka **Merchants** pada dashboard untuk mengelola setiap website topup:

- **Manage** membuka form untuk mengubah nama merchant dan callback URL.
- **Disable merchant** langsung menolak semua request API dari key merchant tersebut, tanpa menghapus riwayat transaksi. Gunakan **Enable merchant** untuk memulihkan akses.
- **Rotate API key** langsung membatalkan key lama dan menghasilkan key baru. Salin key baru yang hanya ditampilkan satu kali, lalu ganti konfigurasi pada website topup sebelum request berikutnya.

## Operasional dan keamanan

- Gunakan HTTPS, password admin panjang, dan `APP_BASE_URL` publik di produksi.
- Jangan menyimpan `.env` atau database SQLite di repository.
- SQLite dipakai untuk single server. Pindah ke PostgreSQL sebelum menjalankan beberapa instance gateway atau trafik tinggi.
- Jalankan `npm test` untuk unit test dan `npm run dev` saat development.

## Developer Documentation

Portal dokumentasi interaktif tersedia di [`/docs`](http://localhost:3000/docs.html). Kontrak OpenAPI tersedia di [`/openapi.yaml`](http://localhost:3000/openapi.yaml), dengan panduan sumber di `docs/api.md` dan `docs/webhooks.md`.
