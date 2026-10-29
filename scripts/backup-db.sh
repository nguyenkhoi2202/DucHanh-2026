#!/bin/bash
# Daily SQLite backup, run on the server from cron.
# Takes a consistent online snapshot through the running app container,
# checks it, gzips it into ~/duchanh-backups and keeps the last KEEP_DAYS days.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/duchanh}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/duchanh-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_NAME=".backup-$STAMP.db"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

# Snapshot into the mounted data folder, verify it, then move it out of there
docker exec duchanh-app node -e "
  const { DatabaseSync, backup } = require('node:sqlite');
  (async () => {
    const src = new DatabaseSync('/app/data/duchanh.db', { readOnly: true });
    await backup(src, '/app/data/$TMP_NAME');
    src.close();
    const copy = new DatabaseSync('/app/data/$TMP_NAME', { readOnly: true });
    const ok = copy.prepare('PRAGMA integrity_check').get().integrity_check;
    const n = copy.prepare('SELECT COUNT(*) AS n FROM patients').get().n;
    copy.close();
    if (ok !== 'ok') throw new Error('integrity_check: ' + ok);
    console.log('patients=' + n);
  })().catch((e) => { console.error(e); process.exit(1); });
"

gzip -c "data/$TMP_NAME" > "$BACKUP_DIR/duchanh-$STAMP.db.gz"
rm -f "data/$TMP_NAME" "data/$TMP_NAME-wal" "data/$TMP_NAME-shm"
find "$BACKUP_DIR" -name 'duchanh-*.db.gz' -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) OK $BACKUP_DIR/duchanh-$STAMP.db.gz ($(du -h "$BACKUP_DIR/duchanh-$STAMP.db.gz" | cut -f1))"
