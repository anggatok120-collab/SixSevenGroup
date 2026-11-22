# Bot WA Pengingat Kuliah

Bot WhatsApp yang mengirim pengingat jadwal kelas, deadline tugas, dan ujian ke **grup kelas**, plus **web** untuk mengelola datanya.

## Fitur
- Ringkasan pagi tiap hari (default 06:00): kelas hari ini, tugas ≤ 3 hari, ujian ≤ 7 hari
- Pengingat kelas 30 menit sebelum mulai
- Pengingat tugas H-3, H-1, dan 3 jam sebelum deadline
- Pengingat ujian H-7, H-1, dan pagi hari-H
- Perintah chat di grup (`/menu`, `/hari`, `/besok`, `/jadwal`, `/tugas`, `/ujian`, `/tambahtugas`, dll.)
- Web pengelola (konsep seperti Akuakalcer: **web untuk mengubah data, bot WA untuk mengirim**):
  - Dashboard: sapaan, 4 angka ringkas, agenda tugas aktif, kelas berikutnya, kalender mingguan
  - Jadwal Kuliah (papan per hari), Tugas (cari, filter, prioritas, catatan), Ujian
  - Pusat Pengingat (admin): nyalakan/matikan tiap jenis pengingat, atur jam, kirim sekarang, pratinjau pesan
  - Status Bot (admin): koneksi WA, grup tujuan, riwayat pengiriman, kirim pesan tes
  - Kelola Akun (admin) dan Profil (ganti nama/password)
  - Mata Kuliah dengan warna sendiri (dipakai di semua halaman) dan progres tugas per mata kuliah
  - Kalender bulanan, Jadwal dalam bentuk papan atau grid jam (jadwal bentrok ditandai merah)
  - Kelas batal & kuliah pengganti per tanggal, bisa langsung diumumkan ke grup; pengingat ikut menyesuaikan
  - Status "sudah kumpul" per anggota untuk tiap tugas (web atau `/kumpul 3` di WA)
  - Pengingat pribadi lewat chat WA untuk anggota yang belum kumpul (nyalakan di Pusat Pengingat)
  - Pengumuman ke grup, langsung atau terjadwal
  - Riwayat perubahan (admin): siapa mengubah apa
  - Langganan kalender (.ics) untuk Google Calendar / kalender HP, dari menu Profil
  - Bisa di-install di HP (PWA) dengan notifikasi push
  - Semester & hari libur: pengingat kelas berhenti otomatis saat libur atau di luar semester
  - Halaman detail mata kuliah: kehadiran pribadi + batas tidak hadir, materi/link, kalkulator nilai, kontak dosen
  - Tugas: link pengumpulan & soal, checklist langkah, tugas kelompok, tugas berulang mingguan; grup diberi tahu kalau tenggat diubah
  - Ujian: materi/kisi-kisi jadi checklist belajar, "yang harus dibawa", link ujian online
  - Pengingat: jam tenang, mode libur, rekap mingguan tiap Minggu
  - Pengumuman: template, gambar, sematkan di dashboard, hanya-web; polling WhatsApp dengan hasil di web
  - Akun: tambah banyak sekaligus (+ sapaan WA), link undangan dengan persetujuan admin, foto profil, terakhir aktif
  - Riwayat: data terhapus bisa dikembalikan 30 hari; filter per orang dan jenis
  - Status bot: antrean pesan 24 jam, grafik pesan per hari, pulihkan backup, peringatan ke admin kalau bot putus/gagal
  - Tema gelap/terang, cari cepat (Ctrl+K), jadwal bisa digeser di grid jam dan disimpan sebagai gambar
  - Tampilan HP dengan menu geser
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
- **Di web**: login per akun dengan 3 peran:
  - **Admin**: semuanya, termasuk Pengingat, Status Bot, dan Kelola Akun
  - **Editor**: tambah/ubah/hapus jadwal, tugas, ujian
  - **Anggota**: hanya melihat
  Akun pertama dibuat otomatis: username `admin`, password = `ADMIN_PASSWORD` di `.env`. Setelah itu ganti password lewat menu Profil dan buat akun untuk teman dari menu Kelola Akun.
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
| Agenda 7 hari | `/minggu` |
| Cari | `/cari laporan` |
| Info mata kuliah / materi | `/matkul kalkulus`, `/materi kalkulus` |
| Tandai sudah kumpul (pribadi) | `/kumpul 3`, atau balas pesan pengingat tugas dengan `udah` |

Tanggal boleh `28-11`, `28/11`, `28-11-2026`, atau `2026-11-28`. Tanpa jam berarti 23:59.

## Deploy otomatis (GitHub Actions)
Setiap push ke `main` menjalankan tes, lalu menyalin kode ke VPS dan me-restart bot dengan pm2
(`.github/workflows/deploy.yml` + `deploy/remote.sh`). `.env`, `data/`, dan `auth/` di VPS tidak disentuh.
Bisa juga dijalankan manual: tab **Actions** → *Tes & deploy ke VPS* → **Run workflow**.

Isi secret di GitHub: **Settings → Secrets and variables → Actions → New repository secret**
| Secret | Isi |
|---|---|
| `VPS_HOST` | IP VPS |
| `VPS_PORT` | port SSH (default 22) |
| `VPS_USER` | user SSH (default `root`) |
| `VPS_SSH_KEY` | private key khusus deploy (disarankan), lihat di bawah |
| `VPS_PASSWORD` | alternatif kalau tidak pakai key |
| `VPS_APP_DIR` | folder bot di VPS (default `/root/wa-pengingat-kuliah`) |

Membuat key deploy (jalankan di VPS), lalu salin seluruh isi private key ke secret `VPS_SSH_KEY`:
```bash
ssh-keygen -t ed25519 -N "" -C github-deploy -f ~/.ssh/github_deploy && cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys && cat ~/.ssh/github_deploy
```

## Pengembangan
```bash
npm test
```
