#!/usr/bin/env bash
# Dijalankan di VPS oleh GitHub Actions setelah kode terbaru disalin ke $APP_DIR.
# Aman dijalankan berulang kali: hanya memasang yang belum ada, lalu me-restart bot.
set -euo pipefail
APP_DIR="${1:-/root/wa-pengingat-kuliah}"
cd "$APP_DIR"

need_node=1
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then need_node=0; fi
if [ "$need_node" = 1 ]; then
  echo "==> Memasang Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs build-essential python3
fi
command -v pm2 >/dev/null 2>&1 || { echo "==> Memasang pm2"; npm install -g pm2; }

echo "==> Memasang dependensi"
npm ci --omit=dev --no-audit --no-fund

if [ ! -f .env ]; then
  cp .env.example .env
  echo "::warning::.env belum ada di VPS. Dibuat dari .env.example; isi ADMIN_PASSWORD, ADMIN_NUMBERS, GROUP_JID, WEB_URL lalu jalankan: pm2 restart wa-pengingat-kuliah"
fi

echo "==> Menjalankan ulang bot"
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
sleep 5
pm2 describe wa-pengingat-kuliah | grep -E "status|restarts|uptime" || true
echo "==> Selesai: $(cat REVISION 2>/dev/null || echo 'versi terbaru')"
