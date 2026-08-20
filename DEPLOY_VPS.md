# Panduan Deployment EvoPay ke VPS (Ubuntu/Debian)

Tutorial ini menjelaskan langkah-langkah untuk melakukan *deploy* EvoPay ke Virtual Private Server (VPS) agar dapat berjalan di lingkungan *production* secara aman, stabil, dan dapat diakses melalui domain menggunakan HTTPS.

## 1. Persiapan Server (Requirements)
Pastikan VPS Anda (Ubuntu 20.04/22.04 LTS atau Debian) memiliki akses root/sudo dan domain yang sudah diarahkan (A record) ke IP VPS Anda (misal: `pay.domainanda.com`).

Perbarui sistem dan instal dependensi dasar:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install curl git build-essential nginx certbot python3-certbot-nginx -y
```

## 2. Instalasi Node.js (Versi 20 LTS)
EvoPay membutuhkan Node.js. Gunakan NodeSource untuk menginstal versi LTS terbaru:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verifikasi instalasi:
```bash
node -v
npm -v
```

## 3. Clone Repositori EvoPay
Kloning repositori GitHub Anda ke dalam direktori `/var/www/`.

```bash
cd /var/www
sudo git clone https://github.com/Zidanyazid/Nexus_Pay.git evopay
sudo chown -R $USER:$USER /var/www/evopay
cd evopay
```

## 4. Instalasi Dependensi & Konfigurasi
Instal semua modul Node.js yang dibutuhkan (tanpa dependensi dev):
```bash
npm ci --production
```

Salin file `.env.example` ke `.env` dan konfigurasikan variabel environment:
```bash
cp .env.example .env
nano .env
```

**Konfigurasi Penting `.env`:**
```ini
NODE_ENV=production
PORT=3000
# Ganti dengan nama domain Anda (tanpa garis miring di akhir)
APP_BASE_URL=https://pay.domainanda.com

# Lokasi penyimpanan database SQLite
DATABASE_PATH=./data/gateway.db

# Kredensial Admin Dashboard
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@domainanda.com
ADMIN_PASSWORD=ganti-dengan-password-super-kuat

# Kredensial Tokopay (Dapatkan di dashboard Tokopay)
TOKOPAY_MERCHANT_ID=M250...
TOKOPAY_SECRET=e0e8...
TOKOPAY_API_URL=https://api.tokopay.id/v1
# IP Webhook resmi Tokopay
TOKOPAY_WEBHOOK_IPS=178.128.104.179
```

## 5. Menjalankan Aplikasi dengan PM2
Gunakan **PM2** sebagai *process manager* agar EvoPay otomatis berjalan di *background* dan *restart* jika server direboot.

Instal PM2 secara global:
```bash
sudo npm install -g pm2
```

Jalankan EvoPay:
```bash
pm2 start src/server.js --name "evopay"
```

Konfigurasi agar PM2 berjalan otomatis saat server restart:
```bash
pm2 startup
# Jalankan perintah yang dihasilkan oleh pm2 startup (copy-paste perintah sudo env PATH...)
pm2 save
```

## 6. Setup Nginx (Reverse Proxy) & HTTPS
Konfigurasikan Nginx agar meneruskan trafik dari port 80/443 (Domain) ke port 3000 (EvoPay).

Buat file konfigurasi Nginx baru:
```bash
sudo nano /etc/nginx/sites-available/evopay
```

Isi dengan konfigurasi berikut (Ganti `pay.domainanda.com` dengan domain Anda):
```nginx
server {
    listen 80;
    server_name pay.domainanda.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Meneruskan IP Client yang sebenarnya ke aplikasi
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan konfigurasi Nginx dan tes sintaks:
```bash
sudo ln -s /etc/nginx/sites-available/evopay /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Mengamankan dengan SSL/HTTPS (Certbot)
Jalankan Certbot untuk mendapatkan sertifikat SSL gratis dari Let's Encrypt:
```bash
sudo certbot --nginx -d pay.domainanda.com
```
*Ikuti instruksi di layar, pilih opsi untuk `Redirect` seluruh trafik HTTP ke HTTPS.*

## 7. Setup Auto-Backup Database (Opsional tapi Direkomendasikan)
Karena EvoPay menggunakan SQLite, Anda dapat mem-backup database dengan mudah menggunakan script yang sudah disediakan (`scripts/database-maintenance.js`).

Tambahkan Cron Job untuk melakukan backup otomatis setiap jam 2 pagi:
```bash
crontab -e
```

Tambahkan baris berikut di bagian paling bawah:
```text
0 2 * * * cd /var/www/evopay && /usr/bin/npm run db:backup >> /var/log/evopay-backup.log 2>&1
```

---

## 8. Selesai! 🎉
EvoPay sekarang sudah berjalan *live* di server Anda! 
1. Buka `https://pay.domainanda.com` di browser.
2. Login menggunakan `ADMIN_USERNAME` dan `ADMIN_PASSWORD` yang Anda set di `.env`.
3. Mulai kelola payment gateway Anda!

### Perintah Berguna (Cheatsheet)
- Melihat log aplikasi secara realtime: `pm2 logs evopay`
- Restart aplikasi (misal setelah ubah `.env`): `pm2 restart evopay`
- Mengecek status keamanan/readiness internal: `npm run check:production`
