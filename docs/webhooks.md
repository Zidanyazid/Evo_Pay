# Webhook EvoPay

EvoPay mengirim event ke callback URL merchant. Balas HTTP `2xx` secepat mungkin dan proses event secara idempoten berdasarkan payment ID.

Event utama: `payment.paid`, `payment.failed`, dan `payment.expired`. Jangan menyerahkan produk berdasarkan redirect browser; gunakan webhook `payment.paid` atau verifikasi ulang melalui API.
