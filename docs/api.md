# NexusPay Merchant API

Base URL: `https://gateway.domain-anda.com/api/v1`

Gunakan `Authorization: Bearer API_KEY` pada setiap request. Untuk operasi POST, kirim `Idempotency-Key` unik agar retry tidak membuat transaksi ganda.

## Status pembayaran

| Status | Arti |
|---|---|
| `PENDING` | Menunggu pembayaran pelanggan |
| `PAID` | Pembayaran terverifikasi; produk boleh diproses |
| `FAILED` | Pembayaran gagal |
| `EXPIRED` | Batas waktu pembayaran berakhir |

Lihat portal dokumentasi di `/docs` untuk contoh interaktif JavaScript, PHP, Python, dan cURL.
