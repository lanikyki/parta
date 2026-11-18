#!/usr/bin/env bash
# Восстановить «Парту» из резервной копии (её делает deploy/backup.sh):
#   sudo bash deploy/restore.sh          показать последние копии
#   sudo bash deploy/restore.sh /root/parta-backups/parta-2026-11-19_010000.tar.gz
# Текущая база не удаляется, а откладывается в папку data.before-restore-ДАТА: если что-то пошло не так, её можно вернуть.
# Совет: один раз проверьте восстановление заранее (например, на втором дешёвом сервере), чтобы точно знать, что копии рабочие.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env"

G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'
[ -t 1 ] || { G='' Y='' R='' N=''; }
ok() { printf '%s[OK]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s[!]%s %s\n' "$Y" "$N" "$*"; }
die() {
  printf '%s[X] %s%s\n' "$R" "$*" "$N" >&2
  exit 1
}
getv() {
  { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/"
}

[ "$(id -u)" -eq 0 ] || die "Нужны права администратора: sudo bash deploy/restore.sh ФАЙЛ"
[ -f docker-compose.yml ] || die "Не нашёл docker-compose.yml рядом с папкой deploy"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  DIR="$(getv BACKUP_DIR)"
  DIR="${DIR:-/root/parta-backups}"
  echo "Последние копии в $DIR:"
  ls -1t "$DIR"/parta-*.tar.gz 2>/dev/null | head -n 5 || true
  die "Укажите файл копии: sudo bash deploy/restore.sh ПУТЬ_К_ФАЙЛУ"
fi
[ -f "$FILE" ] || die "Нет такого файла: $FILE"
FILE="$(readlink -f "$FILE")"
LIST="$(tar -tzf "$FILE" 2>/dev/null)" || die "Архив повреждён или это не копия: $FILE"

if grep -qxF 'db.dump' <<<"$LIST"; then
  echo "В копии дамп внешней базы Postgres (db.dump). Он восстанавливается в пустую базу вручную:"
  echo "  tar -xzf \"$FILE\" db.dump"
  echo "  docker run --rm -i --network host postgres:18-alpine pg_restore --no-owner --no-privileges -d \"\$DATABASE_URL\" < db.dump"
  exit 0
fi
grep -q '^data/' <<<"$LIST" || die "В архиве нет папки data: это точно копия из deploy/backup.sh?"

if [ -t 0 ]; then
  printf 'Восстановить базу из %s? Сайт остановится примерно на минуту, текущая база будет отложена в сторону.\nНапишите «да»: ' "$(basename "$FILE")"
  read -r answer
  [ "$answer" = "да" ] || die "Отменено, ничего не менял"
fi

STAMP="$(date '+%Y-%m-%d_%H%M%S')"
docker compose stop app >/dev/null 2>&1 || true
if [ -d data ]; then
  mv data "data.before-restore-$STAMP"
  ok "Текущая база отложена: $ROOT/data.before-restore-$STAMP"
fi
tar -xzf "$FILE" -C "$ROOT" data
ok "База восстановлена из $(basename "$FILE")"

if grep -qxF '.env' <<<"$LIST"; then
  if [ -f .env ]; then
    tar -xzf "$FILE" -O .env > .env.from-backup
    chmod 600 .env.from-backup
    warn "Настройки (.env) оставил текущие, а настройки из копии положил рядом в .env.from-backup"
  else
    tar -xzf "$FILE" -C "$ROOT" .env
    chmod 600 .env
    ok "Настройки (.env) восстановлены из копии"
  fi
fi

docker compose up -d
code=000
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login || true)"
  [ "$code" = 200 ] && break
  sleep 2
done
if [ "$code" = 200 ]; then ok "Сайт снова работает на восстановленной базе"; else warn "Сайт пока не отвечает: docker compose logs --tail 40 app"; fi
