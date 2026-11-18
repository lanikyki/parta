#!/usr/bin/env bash
# Резервные копии «Парты»: база (папка data: аккаунты, уроки, доски, переписка, файлы, платежи) и настройки (.env).
#
#   sudo bash deploy/backup.sh              сделать копию прямо сейчас
#   sudo bash deploy/backup.sh --install    делать копию каждую ночь в 01:00 по времени сервера (обычно это 04:00 МСК)
#   sudo bash deploy/backup.sh --remove     отключить ночные копии
#   sudo bash deploy/restore.sh ФАЙЛ        восстановить сайт из копии
#
# Копии лежат в /root/parta-backups, хранятся последние 14 (BACKUP_DIR и BACKUP_KEEP в .env).
# На время копии сайт останавливается на несколько секунд, чтобы база не менялась посреди копирования.
# Видео в идущих уроках при этом не прерывается.
#
# Копия на том же диске не спасёт, если умрёт сам сервер. Чтобы копии уезжали ещё и наружу, например на Яндекс Диск:
#   1. Яндекс ID → Безопасность → Пароли приложений → создайте пароль для «Файлы».
#   2. На сервере выполните (ЛОГИН и ПАРОЛЬ_ПРИЛОЖЕНИЯ замените на свои):
#        curl -fsSLO https://downloads.rclone.org/rclone-current-linux-amd64.deb && dpkg -i rclone-current-linux-amd64.deb
#        rclone config create yadisk webdav url=https://webdav.yandex.ru vendor=other user=ЛОГИН pass=ПАРОЛЬ_ПРИЛОЖЕНИЯ --obscure
#   3. В .env допишите строку BACKUP_REMOTE=yadisk:parta-backups и проверьте: sudo bash deploy/backup.sh
# Так же можно отправлять копии в облако S3 или на другой сервер (rclone config, подробно на rclone.org).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env"
CRON_FILE=/etc/cron.d/parta-backup
OFF_MARK=/etc/parta-backup-off

G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'
[ -t 1 ] || { G='' Y='' R='' N=''; } # в журнал cron без цветов
ok() { printf '%s[OK]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s[!]%s %s\n' "$Y" "$N" "$*"; }
die() {
  printf '%s[X] %s%s\n' "$R" "$*" "$N" >&2
  exit 1
}
# getv KEY — значение из .env (без кавычек), как в setup.sh
getv() {
  { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/"
}

[ "$(id -u)" -eq 0 ] || die "Нужны права администратора: sudo bash deploy/backup.sh"
[ -f docker-compose.yml ] || die "Не нашёл docker-compose.yml рядом с папкой deploy"

case "${1:-}" in
  --install)
    if ! command -v cron >/dev/null 2>&1; then
      { apt-get update -qq && apt-get install -y -qq cron; } >/dev/null 2>&1 || die "Не получилось поставить cron: apt-get install cron"
    fi
    systemctl enable --now cron >/dev/null 2>&1 || true
    cat > "$CRON_FILE" <<CRON
# Ночная резервная копия «Парты». Отключить: sudo bash $ROOT/deploy/backup.sh --remove
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 1 * * * root bash "$ROOT/deploy/backup.sh" >> /var/log/parta-backup.log 2>&1
CRON
    chmod 644 "$CRON_FILE"
    rm -f "$OFF_MARK"
    ok "Ночные копии включены: каждый день в 01:00 по времени сервера (сейчас на сервере $(date '+%H:%M %Z'))"
    echo "    Журнал: /var/log/parta-backup.log. Сделать копию прямо сейчас: sudo bash deploy/backup.sh"
    exit 0
    ;;
  --remove)
    rm -f "$CRON_FILE"
    touch "$OFF_MARK" # чтобы setup.sh при обновлении не включил копии обратно
    ok "Ночные копии отключены (уже сделанные копии не тронуты)"
    exit 0
    ;;
  '') ;;
  *) die "Не знаю параметр $1. Можно без параметров, --install или --remove" ;;
esac

DIR="$(getv BACKUP_DIR)"
DIR="${DIR:-/root/parta-backups}"
KEEP="$(getv BACKUP_KEEP)"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || KEEP=14
REMOTE="$(getv BACKUP_REMOTE)"
DB_URL="$(getv DATABASE_URL)"

mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/parta-$(date '+%Y-%m-%d_%H%M%S').tar.gz"
TMP="$(mktemp -d)"
STOPPED=0
finish() {
  # Что бы ни случилось, сайт должен снова заработать
  if [ "$STOPPED" = 1 ]; then
    docker compose start app >/dev/null 2>&1 || warn "Сайт не запустился обратно! Запустите вручную: cd $ROOT && docker compose start app"
  fi
  rm -rf "$TMP" "$OUT.part"
}
trap finish EXIT

echo "$(date '+%Y-%m-%d %H:%M:%S') Резервная копия: $OUT"
items=()
[ -f "$ENV_FILE" ] && items+=(-C "$ROOT" .env)

if [ -n "$DB_URL" ]; then
  # Внешний Postgres (DATABASE_URL): pg_dump сам делает согласованный снимок, сайт не останавливаем
  docker run --rm --network host postgres:18-alpine pg_dump --no-owner --no-privileges -Fc "$DB_URL" > "$TMP/db.dump" ||
    die "pg_dump не сработал: проверьте DATABASE_URL в .env"
  items+=(-C "$TMP" db.dump)
else
  [ -d "$ROOT/data" ] || die "Нет папки data: похоже, сайт ещё ни разу не запускался"
  need="$(du -sk "$ROOT/data" | cut -f1)"
  free="$(df -Pk "$DIR" | awk 'NR == 2 { print $4 }')"
  [ "$free" -gt "$need" ] || die "Мало места для копии: база занимает $((need / 1024)) МБ, свободно $((free / 1024)) МБ"
  # Встроенная база (PGlite): на время копирования останавливаем сайт, чтобы база не менялась посреди копии
  if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
    docker compose stop app >/dev/null
    STOPPED=1
  fi
  items+=(-C "$ROOT" data)
fi

tar -czf "$OUT.part" "${items[@]}"
if [ "$STOPPED" = 1 ]; then
  docker compose start app >/dev/null
  STOPPED=0
fi
mv "$OUT.part" "$OUT"
chmod 600 "$OUT"
ok "Копия готова: $OUT ($(du -h "$OUT" | cut -f1))"

# Храним только последние $KEEP копий
ls -1t "$DIR"/parta-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f -- "$old"; done

if [ -z "$REMOTE" ]; then
  warn "Копия есть только на этом сервере. Если умрёт сервер, пропадёт и она: настройте BACKUP_REMOTE (инструкция в начале deploy/backup.sh)"
  exit 0
fi
command -v rclone >/dev/null 2>&1 || die "В .env указан BACKUP_REMOTE, но rclone не установлен (инструкция в начале deploy/backup.sh)"
rclone copy "$OUT" "$REMOTE" --retries 3 || die "Не получилось отправить копию в $REMOTE. Копия на сервере сохранена: $OUT"
ok "Копия отправлена в $REMOTE"
# Там тоже не копим бесконечно: удаляем только свои архивы старше $KEEP дней
rclone delete "$REMOTE" --include 'parta-*.tar.gz' --max-depth 1 --min-age "${KEEP}d" >/dev/null 2>&1 || true
