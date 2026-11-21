# Bot WA Pengingat Kuliah

Bot WhatsApp yang mengirim pengingat jadwal kelas, deadline tugas, dan ujian ke **grup kelas**, plus **web** untuk mengelola datanya.

## Fitur
- Ringkasan pagi tiap hari (default 06:00): kelas hari ini, tugas ≤ 3 hari, ujian ≤ 7 hari
- Pengingat kelas 30 menit sebelum mulai
- Pengingat tugas H-3, H-1, dan 3 jam sebelum deadline
- Pengingat ujian H-7, H-1, dan pagi hari-H
- Perintah chat di grup (`/menu`, `/hari`, `/besok`, `/jadwal`, `/tugas`, `/ujian`, `/tambahtugas`, dll.)
- Web UI: lihat dan kelola jadwal, tugas, ujian (login password; opsional bisa dilihat teman tanpa login)
- Semua waktu bisa diatur di `.env`

## Kebutuhan
- VPS dengan Node.js 20+ dan pm2
- Nomor WhatsApp untuk bot (disarankan nomor cadangan, bukan nomor utama)
- Domain yang diarahkan ke IP VPS (A record) dan nginx

## Pasang di VPS
```bash
git clone <repo-ini> wa-pengingat-kuliah && cd wa-pengingat-kuliah
npm install            # butuh build-essential & python3 untuk better-sqlite3 kalau prebuild tidak tersedia
cp .env.example .env   # isi ADMIN_NUMBERS dan ADMIN_PASSWORD dulu
npm start              # sekali saja, untuk scan QR
```
1. Scan QR yang muncul dari HP bot: WhatsApp → Perangkat tertaut → Tautkan perangkat.
   Tidak bisa scan (misal lewat SSH)? Isi `PAIRING_NUMBER` dengan nomor bot, lalu masukkan kode 8 huruf dari log di HP bot: Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon.
2. Masukkan nomor bot ke grup kelas, lalu ketik `/groupid` di grup. Salin ID-nya ke `GROUP_JID` di `.env`.
3. Hentikan (`Ctrl+C`), lalu jalankan dengan pm2:
```bash
pm2 start ecosystem.config.js
pm2 save
```
Sesi login WA tersimpan di folder `auth/`, data di `data/kuliah.db`. Backup dua folder itu.

## Pasang di domain (nginx + HTTPS)
Web jalan di `127.0.0.1:3000` (tidak terbuka langsung ke internet). Buat `/etc/nginx/sites-available/kuliah`:
```nginx
server {
    server_name kuliah.domainmu.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/kuliah /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d kuliah.domainmu.com
```

## Siapa yang boleh mengubah data
- **Di web**: siapa pun yang tahu `ADMIN_PASSWORD`.
- **Di WA**: nomor di `ADMIN_NUMBERS` dan admin grup.
- Semua anggota grup bisa memakai perintah lihat (`/hari`, `/tugas`, ...).

## Perintah WA
| Perintah | Contoh |
|---|---|
| Tambah kelas | `/tambahkelas Senin \| 08:00-09:40 \| Kalkulus \| R.301 \| Pak Budi` |
| Tambah banyak kelas | `/importjadwal` lalu satu kelas per baris dengan format di atas (tanpa `/tambahkelas`) |
| Tambah tugas | `/tambahtugas Basis Data \| Laporan ERD \| 28-11 23:59` |
| Tambah ujian | `/tambahujian Kalkulus \| UTS \| 02-12 08:00 \| R.301` |
| Tandai tugas selesai | `/selesai 3` |
| Hapus | `/hapustugas 3`, `/hapusujian 2`, `/hapuskelas 5` |

Tanggal boleh `28-11`, `28/11`, `28-11-2026`, atau `2026-11-28`. Tanpa jam berarti 23:59.

## Pengembangan
```bash
npm test
```
