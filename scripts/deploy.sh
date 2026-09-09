#!/usr/bin/env bash
# Se corre EN el servidor (EC2), dentro del repo clonado.
#   ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> git pull"
git pull --ff-only

echo "==> npm ci"
npm ci --omit=dev

echo "==> pm2 reload"
pm2 reload ecosystem.config.cjs --update-env
pm2 save

echo "==> listo"
pm2 status sorteo-api
