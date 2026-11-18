#!/usr/bin/env bash
# «Парта» на своём сервере — установка одной командой (Ubuntu 22.04 или 24.04):
#
#   sudo bash deploy/setup.sh
#
# Скрипт спросит домен и почту, сам поставит Docker, создаст ключи видеосервера, откроет порты
# и запустит сайт с HTTPS (сертификат Caddy получит сам).
# Запустить ещё раз — пересобрать сайт после обновления: настройки (.env) и база (папка data) сохраняются.
# Без вопросов: DOMAIN=parta.ru ADMIN_EMAILS=me@mail.ru sudo -E bash deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' B=$'\e[1m' N=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok() { printf '%s[OK]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s[!]%s %s\n' "$Y" "$N" "$*"; }
die() {
  printf '\n%s[X] %s%s\n' "$R" "$*" "$N" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "Нужны права администратора. Запустите так: sudo bash deploy/setup.sh"
[ -f docker-compose.yml ] && [ -f Dockerfile ] || die "Не нашёл файлы проекта. Сначала перейдите в папку проекта: cd parta"
command -v apt-get >/dev/null || die "Скрипт рассчитан на Ubuntu или Debian. Для другой системы — README, «Вариант Б», шаги вручную."

# ---------- Настройки в .env ----------
ENV_FILE=.env
FIRST=0 # первый запуск: задаём и необязательные вопросы (почта, ИИ); при обновлении — только подсказки
[ -f "$ENV_FILE" ] || { cp .env.example "$ENV_FILE"; FIRST=1; }
chmod 600 "$ENV_FILE"

# getv KEY [файл] — значение из файла настроек (без кавычек)
getv() {
  { grep -E "^$1=" "${2:-$ENV_FILE}" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/"
}
# setv KEY значение — записать (заменить или добавить строку)
setv() {
  local v="$2"
  case "$v" in
    *"'"*) ;;
    *[\$\ \#\"]*) v="'$v'" ;;
  esac
  K="$1" V="$v" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { if (!d) print k "=" v; d = 1; next }
    { print }
    END { if (!d) print k "=" v }' "$ENV_FILE" > "$ENV_FILE.tmp"
  cat "$ENV_FILE.tmp" > "$ENV_FILE"
  rm -f "$ENV_FILE.tmp"
}

TTY=0
[ -t 0 ] && TTY=1
# ask VAR "Вопрос" [по умолчанию] / ask_secret VAR "Вопрос" — ответ пользователя (Enter — по умолчанию)
ask() {
  local ans=""
  if [ "$TTY" = 1 ]; then read -r -p "$2${3:+ [$3]}: " ans || true; fi
  printf -v "$1" '%s' "${ans:-${3:-}}"
}
ask_secret() {
  local ans=""
  if [ "$TTY" = 1 ]; then
    read -r -s -p "$2: " ans || true
    echo
  fi
  printf -v "$1" '%s' "$ans"
}
# Значение настройки: из переменной окружения, из .env или ответ на вопрос
pick() {
  local cur="${!1:-}"
  [ -n "$cur" ] || cur="$(getv "$1")"
  printf '%s' "$cur"
}

norm_domain() {
  local d
  d="$(printf '%s' "$1" | tr -d '[:space:]')"
  d="${d#http://}"
  d="${d#https://}"
  d="${d%%/*}"
  d="${d%.}"
  if printf '%s' "$d" | LC_ALL=C grep -q '[^ -~]'; then
    # Кириллический домен (например, парта.рф) — в вид, понятный серверу (xn--…)
    d="$(python3 -c 'import sys; print(sys.argv[1].encode("idna").decode())' "$d" 2>/dev/null || true)"
  fi
  printf '%s' "$d" | tr '[:upper:]' '[:lower:]'
}
valid_domain() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$ ]]; }

step "Настройки сайта"
# Значения, переданные при запуске (DOMAIN=… AI_API_KEY=… sudo -E bash deploy/setup.sh), — сразу в .env
for k in DOMAIN LIVEKIT_DOMAIN ADMIN_EMAILS SMTP_USER SMTP_PASS SMTP_HOST SMTP_PORT MAIL_FROM AI_BASE_URL AI_API_KEY AI_MODEL_SMART AI_MODEL_FAST DATABASE_URL; do
  [ -z "${!k:-}" ] || setv "$k" "${!k}"
done
# Если рядом лежит .env.local с компьютера — берём оттуда ИИ и почту
if [ -f .env.local ]; then
  for k in AI_BASE_URL AI_API_KEY AI_MODEL_SMART AI_MODEL_FAST SMTP_USER SMTP_PASS SMTP_HOST SMTP_PORT MAIL_FROM ADMIN_EMAILS; do
    v="$(getv "$k" .env.local)"
    if [ -z "$(getv "$k")" ] && [ -n "$v" ]; then setv "$k" "$v"; fi
  done
  ok "Взял настройки ИИ и почты из .env.local"
fi

raw="$(pick DOMAIN)"
DOMAIN="$(norm_domain "$raw")"
while ! valid_domain "$DOMAIN"; do
  [ "$TTY" = 1 ] || die "Укажите домен: DOMAIN=parta.ru sudo -E bash deploy/setup.sh"
  [ -z "$raw" ] || warn "«$raw» не похоже на домен. Пример: parta-school.ru"
  ask raw "Домен сайта (например, parta-school.ru)"
  DOMAIN="$(norm_domain "$raw")"
done
setv DOMAIN "$DOMAIN"

LIVEKIT_DOMAIN="$(norm_domain "$(pick LIVEKIT_DOMAIN)")"
valid_domain "$LIVEKIT_DOMAIN" || LIVEKIT_DOMAIN="live.$DOMAIN"
setv LIVEKIT_DOMAIN "$LIVEKIT_DOMAIN"
setv LIVEKIT_URL "wss://$LIVEKIT_DOMAIN"
# Для сообщений — домен как в браузере (кириллица, если домен кириллический)
SHOW="$(python3 -c 'import sys; print(sys.argv[1].encode().decode("idna"))' "$DOMAIN" 2>/dev/null || true)"
SHOW="${SHOW:-$DOMAIN}"
ok "Сайт: https://$SHOW, видео: $LIVEKIT_DOMAIN"

ADMIN_EMAILS="$(pick ADMIN_EMAILS)"
if [ -z "$ADMIN_EMAILS" ] && [ "$TTY" = 1 ] && [ "$FIRST" = 1 ]; then
  ask ADMIN_EMAILS "Ваша почта — для входа в админку (Enter — пропустить)"
fi
[ -z "$ADMIN_EMAILS" ] || setv ADMIN_EMAILS "$ADMIN_EMAILS"

SMTP_USER="$(pick SMTP_USER)"
if [ -z "$SMTP_USER" ] && [ "$TTY" = 1 ] && [ "$FIRST" = 1 ]; then
  echo
  echo "Почта сайта: с неё приходят коды при регистрации. Нужен «пароль приложения» (README, раздел «Почта»)."
  ask SMTP_USER "Адрес почты сайта, например parta.online@yandex.ru (Enter — настроить позже)"
  if [ -n "$SMTP_USER" ]; then
    ask_secret SMTP_PASS "Пароль приложения для $SMTP_USER (символы не показываются)"
    setv SMTP_USER "$SMTP_USER"
    setv SMTP_PASS "$SMTP_PASS"
  fi
fi

if [ -z "$(pick AI_API_KEY)" ] && [ "$TTY" = 1 ] && [ "$FIRST" = 1 ]; then
  echo
  echo "ИИ-помощник и «Итоги урока» (любой OpenAI-совместимый сервис, например DeepSeek)."
  ask AI_BASE_URL "Адрес сервиса ИИ, например https://api.deepseek.com (Enter — настроить позже)"
  if [ -n "$AI_BASE_URL" ]; then
    ask_secret AI_API_KEY "Ключ ИИ (символы не показываются)"
    ask AI_MODEL_SMART "Модель" "deepseek-chat"
    setv AI_BASE_URL "$AI_BASE_URL"
    setv AI_API_KEY "$AI_API_KEY"
    setv AI_MODEL_SMART "$AI_MODEL_SMART"
  fi
fi

# Ключи видеосервера: свои для каждого сервера
rand() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
lk_key="$(getv LIVEKIT_API_KEY)"
lk_secret="$(getv LIVEKIT_API_SECRET)"
if [ -z "$lk_key" ] || [ "$lk_key" = devkey ] || [ "${#lk_secret}" -lt 32 ]; then
  setv LIVEKIT_API_KEY "API$(rand 6)"
  setv LIVEKIT_API_SECRET "$(rand 24)"
  ok "Созданы ключи видеосервера"
fi
ok "Настройки сохранены в $(pwd)/.env"

# ---------- Домен указывает на сервер? ----------
step "Проверяю домен"
public_ip() {
  local ip u
  for u in https://ipv4-internet.yandex.net/api/v0/ip https://api.ipify.org https://ifconfig.me; do
    ip="$(curl -4 -fsS --max-time 6 "$u" 2>/dev/null | tr -d '"[:space:]' || true)"
    if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "$ip"
      return
    fi
  done
  { ip route get 1.1.1.1 2>/dev/null || true; } | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'
}
# Пока домен не настроен, getent ничего не находит — это не ошибка
resolve() { { getent ahostsv4 "$1" 2>/dev/null || true; } | awk 'NR == 1 { print $1 }'; }
IP="$(public_ip)"
DNS_OK=1
for d in "$DOMAIN" "$LIVEKIT_DOMAIN"; do
  got="$(resolve "$d")"
  if [ -n "$IP" ] && [ "$got" = "$IP" ]; then
    ok "$d → $IP"
  else
    DNS_OK=0
    warn "$d пока указывает ${got:-никуда}, а нужен IP этого сервера${IP:+ ($IP)}."
  fi
done
if [ "$DNS_OK" = 0 ]; then
  echo "    У регистратора домена в управлении DNS добавьте две A-записи со значением ${IP:-IP сервера}:"
  echo "    «@» (сам домен) и «${LIVEKIT_DOMAIN%%.*}» (видео). Можно продолжать: сайт откроется сам,"
  echo "    когда записи обновятся (от 15 минут до нескольких часов)."
fi

# ---------- Память ----------
mem_mb="$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
if [ "$mem_mb" -lt 3500 ] && ! swapon --show 2>/dev/null | grep -q .; then
  step "Памяти ${mem_mb} МБ — добавляю файл подкачки 2 ГБ, чтобы хватило на сборку"
  mkswapfile() { chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; }
  if { fallocate -l 2G /swapfile 2>/dev/null && mkswapfile; } ||
    { rm -f /swapfile && dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none && mkswapfile; }; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "Подкачка включена"
  else
    rm -f /swapfile
    warn "Не получилось создать подкачку — если сборка оборвётся, возьмите сервер с 4 ГБ памяти"
  fi
fi

# ---------- Docker ----------
install_docker() {
  step "Ставлю Docker (пара минут)"
  if curl -fsSL --max-time 60 https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh; then return 0; fi
  warn "Официальный установщик Docker недоступен — ставлю Docker из репозитория Ubuntu"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 || DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-buildx >/dev/null 2>&1 || true
}
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then install_docker; fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Не получилось установить Docker. Попробуйте вручную: apt-get install -y docker.io docker-compose-v2 — и запустите скрипт снова."
ok "$(docker --version)"

# Образы с Docker Hub. Если он недоступен из этой сети — подключаем зеркала
# Версия видеосервера берётся из docker-compose.yml, чтобы не разъезжалась
LK_IMAGE="$(awk '$1 == "image:" && $2 ~ /^livekit\// { print $2; exit }' docker-compose.yml)"
IMAGES="node:22-alpine caddy:2 ${LK_IMAGE:-livekit/livekit-server:latest}"
pull_all() {
  local i
  for i in $IMAGES; do docker pull -q "$i" >/dev/null 2>&1 || return 1; done
}
step "Скачиваю образы (сайт, видеосервер, HTTPS)"
if ! pull_all; then
  warn "Docker Hub не отвечает — подключаю зеркала"
  command -v python3 >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y python3 >/dev/null
  python3 - <<'PY'
import json, os
p = '/etc/docker/daemon.json'
d = {}
if os.path.exists(p):
    try:
        d = json.load(open(p))
    except Exception:
        d = {}
m = d.get('registry-mirrors', [])
for u in ['https://dockerhub.timeweb.cloud', 'https://mirror.gcr.io']:
    if u not in m:
        m.append(u)
d['registry-mirrors'] = m
os.makedirs('/etc/docker', exist_ok=True)
json.dump(d, open(p, 'w'), indent=2)
PY
  systemctl restart docker
  sleep 3
  pull_all || die "Не получилось скачать образы Docker. Проверьте интернет на сервере и запустите скрипт снова."
fi
ok "Образы скачаны"

# ---------- Порты ----------
step "Порты"
busy="$(ss -Hltnp 2>/dev/null | awk '$4 ~ /:(80|443)$/ { print $6 }' | grep -o '"[^"]*"' | tr -d '"' | grep -v -x -E 'caddy|docker-proxy' | sort -u | tr '\n' ' ' || true)"
if [ -n "$busy" ]; then
  warn "Порты 80/443 заняты программой: $busy"
  ans=y
  [ "$TTY" = 1 ] && ask ans "Выключить её, чтобы освободить порты для сайта? (y/n)" "y"
  if [ "$ans" = y ] || [ "$ans" = Y ] || [ "$ans" = д ] || [ "$ans" = Д ]; then
    for s in nginx apache2 httpd caddy lighttpd; do systemctl disable --now "$s" >/dev/null 2>&1 || true; done
  fi
fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 7881/tcp >/dev/null
  ufw allow 3478/udp >/dev/null
  ufw allow 50000:60000/udp >/dev/null
  ok "Файрвол ufw: открыл 80, 443, 7881/tcp, 3478/udp, 50000–60000/udp"
else
  ok "Файрвол на сервере выключен. Если у хостинга есть файрвол в панели — откройте там 80, 443, 7881/tcp, 3478/udp и 50000–60000/udp"
fi

# ---------- Сборка и запуск ----------
step "Собираю и запускаю сайт (первый раз — 5–10 минут)"
mkdir -p data
docker compose up -d --build || die "Сборка не удалась — причина в сообщениях выше. Частая: мало памяти (нужно от 2 ГБ)."

code=000
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login || true)"
  [ "$code" = 200 ] && break
  sleep 2
done
if [ "$code" != 200 ]; then
  docker compose logs --tail 40 app || true
  die "Сайт не запустился — последние строки журнала выше."
fi
ok "Сайт запущен"
lk="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:7880/ || true)"
[ "$lk" = 200 ] && ok "Видеосервер запущен" || warn "Видеосервер не отвечает — журнал: docker compose logs livekit"

if [ "$DNS_OK" = 1 ]; then
  step "Жду сертификат HTTPS"
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/login" || true)"
    [ "$code" = 200 ] && break
    sleep 3
  done
  if [ "$code" = 200 ]; then ok "https://$SHOW открывается"; else warn "HTTPS пока не готов — Caddy получит сертификат сам в ближайшие минуты (журнал: docker compose logs caddy)"; fi
fi

# ---------- Резервные копии ----------
step "Резервные копии"
if [ -f /etc/parta-backup-off ]; then
  warn "Ночные копии выключены (включить: sudo bash deploy/backup.sh --install)"
else
  bash deploy/backup.sh --install || warn "Не получилось включить ночные копии: sudo bash deploy/backup.sh --install"
fi

# ---------- Итог ----------
printf '\n%sГотово! Сайт: https://%s%s\n' "$G$B" "$SHOW" "$N"
[ "$DNS_OK" = 1 ] || echo "  (откроется, когда домен начнёт указывать на этот сервер)"
admin="$(getv ADMIN_EMAILS)"
echo "  1. Зарегистрируйтесь на сайте${admin:+ с почтой $admin — у вас будет админка https://$SHOW/admin}."
echo "  2. Создайте урок и отправьте ученику ссылку."
if [ -z "$(getv SMTP_USER)" ] || [ -z "$(getv SMTP_PASS)" ]; then
  warn "Почта не настроена: коды при регистрации не придут на почту. Код можно посмотреть так:"
  echo "      docker compose logs app | grep 'Код для'"
  echo "    Настроить почту: впишите SMTP_USER и SMTP_PASS в $(pwd)/.env и запустите скрипт ещё раз."
fi
if [ -z "$(getv AI_API_KEY)" ]; then
  warn "ИИ-помощник не настроен: впишите AI_BASE_URL, AI_API_KEY и AI_MODEL_SMART в $(pwd)/.env и запустите скрипт ещё раз."
fi
echo
echo "Полезное (в папке $(pwd)):"
echo "  журнал сайта:  docker compose logs -f app      перезапуск:  docker compose restart"
echo "  обновить сайт: распакуйте новый архив поверх (unzip -o parta.zip) и снова: sudo bash deploy/setup.sh"
echo "  резервные копии: каждую ночь в /root/parta-backups; сделать сейчас: sudo bash deploy/backup.sh; восстановить: sudo bash deploy/restore.sh"
[ -n "$(getv BACKUP_REMOTE)" ] || warn "Копии пока лежат только на этом сервере. Чтобы они уезжали на Яндекс Диск или в облако, см. начало deploy/backup.sh"
