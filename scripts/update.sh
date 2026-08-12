#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_PATH"

MODE=""
BRANCH=""
SERVICE_NAME="${SERVICE_NAME:-NetRelayMQTT}"

usage() {
  cat <<'EOF'
Kullanım: ./scripts/update.sh [--docker|--git] [--branch <dal>]

  --docker   Docker Compose ile güncelle (.env ve volume korunur)
  --git      git pull + npm ci ile güncelle (.env / users.json / sqlite korunur)
  --branch   git pull için dal (varsayılan: mevcut dal)

Parametre verilmezse çalışan Docker kurulumu varsa docker, değilse git kullanılır.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE=docker; shift ;;
    --git) MODE=git; shift ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Bilinmeyen seçenek: $1" >&2; usage; exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }

docker_compose_available() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

docker_deploy_running() {
  [[ -f "$PROJECT_PATH/compose.yml" ]] || return 1
  docker_compose_available || return 1
  docker compose ps --format '{{.Name}}' 2>/dev/null | grep -Eq 'netrelay-mqtt-server|mqttserver'
}

assert_protected_files() {
  for name in .env users.json security.sqlite3; do
    if [[ -e "$PROJECT_PATH/$name" ]]; then
      echo "Korunan dosya mevcut: $name"
    fi
  done
}

update_docker() {
  step 'Docker kurulumu güncelleniyor (.env ve volume verileri korunur)'
  assert_protected_files
  docker compose pull
  docker compose up -d
  echo 'Docker güncellemesi tamamlandı.'
  docker compose ps
}

update_git() {
  step 'Git kurulumu güncelleniyor (.env, users.json, security.sqlite3 korunur)'
  [[ -d "$PROJECT_PATH/.git" ]] || {
    echo 'Bu klasör bir git deposu değil. ZIP kurulumunda dosyaları elle güncelleyin veya git clone kullanın.' >&2
    exit 1
  }

  assert_protected_files

  if [[ -n "$(git status --porcelain)" ]]; then
    echo 'Yerel değişiklikler var; güvenli güncelleme iptal edildi.' >&2
    git status --porcelain >&2
    exit 1
  fi

  local current_branch target_branch
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  target_branch="${BRANCH:-$current_branch}"
  echo "Dal: $target_branch"

  git fetch origin
  git pull --ff-only "origin" "$target_branch"

  step 'Bağımlılıklar kuruluyor (npm ci --omit=dev)'
  npm ci --omit=dev

  if command -v systemctl >/dev/null 2>&1 && systemctl list-units --type=service --all 2>/dev/null | grep -q "$SERVICE_NAME"; then
    step "systemd servisi yeniden başlatılıyor: $SERVICE_NAME"
    sudo systemctl restart "$SERVICE_NAME"
    systemctl --no-pager --full status "$SERVICE_NAME" || true
    echo 'Güncelleme tamamlandı.'
    return
  fi

  if command -v pm2 >/dev/null 2>&1; then
    for name in netrelay-mqtt netrelay-mqtt-server; do
      if pm2 describe "$name" >/dev/null 2>&1; then
        step "PM2 süreci yeniden başlatılıyor: $name"
        pm2 restart "$name"
        echo 'Güncelleme tamamlandı.'
        return
      fi
    done
  fi

  echo 'Kod güncellendi. Çalışan süreci elle yeniden başlatın (npm start / systemd / PM2).'
}

if [[ -z "$MODE" ]]; then
  if docker_deploy_running; then MODE=docker; else MODE=git; fi
fi

echo "NetRelay MQTT güncelleme | Mod: $MODE | Klasör: $PROJECT_PATH"
if [[ "$MODE" == docker ]]; then update_docker; else update_git; fi
