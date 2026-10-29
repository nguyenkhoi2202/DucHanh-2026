#!/bin/bash
# Deploys the app to a server with Docker, behind the Cloudflare Tunnel "duchanh".
#
# Usage: scripts/deploy.sh user@host [--with-db]
#   --with-db  also copy the local database (data/duchanh.db) to the server.
#              Refuses to overwrite a database that already exists there.
set -euo pipefail

TARGET="${1:?Cách dùng: scripts/deploy.sh user@host [--with-db]}"
WITH_DB="${2:-}"
REMOTE_DIR="duchanh"
cd "$(dirname "$0")/.."

for f in .env deploy/cloudflared/config.yml; do
  [ -f "$f" ] || { echo "Thiếu $f"; exit 1; }
done

echo "==> Kiểm tra kết nối và Docker trên $TARGET"
ssh -o ConnectTimeout=10 "$TARGET" 'docker compose version >/dev/null' \
  || { echo "Không SSH được, hoặc server chưa có Docker Compose"; exit 1; }
ssh "$TARGET" "mkdir -p $REMOTE_DIR/data && chmod 700 $REMOTE_DIR"

echo "==> Đẩy mã nguồn và cấu hình"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude dist-server --exclude .git \
  --exclude data --exclude .playwright-mcp --exclude deploy --exclude .env \
  ./ "$TARGET:$REMOTE_DIR/"
rsync -az --delete deploy/cloudflared/ "$TARGET:$REMOTE_DIR/cloudflared/"
rsync -az .env "$TARGET:$REMOTE_DIR/.env"

if [ "$WITH_DB" = "--with-db" ]; then
  if ssh "$TARGET" "test -s $REMOTE_DIR/data/duchanh.db"; then
    echo "Server đã có data/duchanh.db, không ghi đè. Xoá file đó trên server nếu thật sự muốn thay."
    exit 1
  fi
  echo "==> Sao lưu DB (an toàn khi đang chạy) và đẩy lên"
  SNAPSHOT="$(mktemp -d)/duchanh.db"
  sqlite3 data/duchanh.db ".backup '$SNAPSHOT'"
  rsync -az "$SNAPSHOT" "$TARGET:$REMOTE_DIR/data/duchanh.db"
  rm -f "$SNAPSHOT"
fi

if ssh "$TARGET" "docker ps -q -f name=^duchanh-app\$ | grep -q ."; then
  echo "==> Sao lưu DB trên server trước khi cập nhật (bản mới có thể nâng cấp cấu trúc DB)"
  ssh "$TARGET" "$REMOTE_DIR/scripts/backup-db.sh"
fi

echo "==> Build và chạy trên server"
ssh "$TARGET" "cd $REMOTE_DIR && \
  docker run --rm -v \"\$PWD/data:/d\" -v \"\$PWD/cloudflared:/c\" node:24-bookworm-slim \
    sh -c 'chown -R 1000:1000 /d && chmod 755 /c && chmod 644 /c/*' && \
  docker compose up -d --build && docker compose ps"

echo "==> Xong. Kiểm tra: https://duchanh.khoitn.io.vn"
