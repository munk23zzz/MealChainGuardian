#!/usr/bin/env bash
# =============================================================================
# MealChain Guardian — verifikasi kondisi VPS setelah setup-vps.sh
# =============================================================================
# Hanya MEMBACA keadaan sistem. Tidak mengubah apa pun.
# Setiap baris menghasilkan PASS / FAIL / WARN / SKIP, plus exit code:
#   0 = semua PASS (atau WARN/SKIP saja), 1 = ada FAIL
#
# Pemakaian: sudo bash verify-vps.sh [--ssh-port 22] [--deploy-user deploy]
# =============================================================================
set -uo pipefail

DEPLOY_USER="deploy"
SSH_PORT="22"
PROJECT_ROOT="/srv/mealchain"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-user) DEPLOY_USER="${2:?}"; shift 2 ;;
    --ssh-port)    SSH_PORT="${2:?}"; shift 2 ;;
    --project-root) PROJECT_ROOT="${2:?}"; shift 2 ;;
    -h|--help)     sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "flag tidak dikenal: $1" >&2; exit 1 ;;
  esac
done

if [[ -t 1 ]]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; B=$'\033[36m'; N=$'\033[0m'
else
  G=""; Y=""; R=""; B=""; N=""
fi
FAILS=0
printf '%s== MealChain Guardian — verifikasi VPS (%s) ==%s\n\n' "$B" "$(date -Is)" "$N"

pass() { printf '%sPASS%s %s\n' "$G" "$N" "$1"; }
fail() { printf '%sFAIL%s %s\n' "$R" "$N" "$1"; FAILS=$((FAILS+1)); }
warn() { printf '%sWARN%s %s\n' "$Y" "$N" "$1"; }
skip() { printf '%sSKIP%s %s\n' "$Y" "$N" "$1"; }
sect() { printf '\n-- %s\n' "$1"; }

has_systemd() { [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; }

sect "OS & sumber daya"
# shellcheck disable=SC1091
. /etc/os-release 2>/dev/null || true
if [[ "${ID:-}" == "ubuntu" ]]; then pass "OS: Ubuntu ${VERSION_ID} (${PRETTY_NAME:-})"; else fail "OS bukan Ubuntu (${ID:-unknown})"; fi
printf '     CPU %s core | RAM %s MB | disk / %s bebas\n' "$(nproc)" "$(free -m | awk '/^Mem:/{print $2}')" "$(df -h / | awk 'NR==2{print $4}')"

sect "Swap"
SWAP_TOTAL="$(free -m | awk '/^Swap:/{print $2}')"
if [[ "${SWAP_TOTAL:-0}" -gt 0 ]]; then
  pass "swap aktif: ${SWAP_TOTAL} MB"
  grep -qE '^/swapfile[[:space:]]' /etc/fstab && pass "/swapfile tercatat di /etc/fstab (persisten setelah reboot)" || warn "/swapfile TIDAK ada di /etc/fstab — hilang setelah reboot"
else
  fail "swap tidak aktif (VPS 2 GB wajib punya swap)"
fi

sect "Timezone & sinkronisasi waktu"
TZ_NOW="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
if [[ -z "$TZ_NOW" ]]; then
  if [[ -r /etc/timezone ]]; then
    TZ_NOW="$(cat /etc/timezone)"
  else
    TZ_NOW="$(readlink -f /etc/localtime 2>/dev/null | sed 's#.*/zoneinfo/##')"
  fi
fi
[[ "$TZ_NOW" == "Asia/Jakarta" ]] && pass "timezone: Asia/Jakarta" || warn "timezone: ${TZ_NOW:-?} (harapan Asia/Jakarta)"
if has_systemd; then
  timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes && pass "jam tersinkron NTP" || warn "jam belum tersinkron NTP"
else
  skip "cek NTP (systemd tidak tersedia di lingkungan ini)"
fi

sect "User deploy"
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  pass "user '${DEPLOY_USER}' ada (shell: $(getent passwd "$DEPLOY_USER" | cut -d: -f7))"
  id -nG "$DEPLOY_USER" | grep -qw sudo && pass "'${DEPLOY_USER}' anggota grup sudo" || fail "'${DEPLOY_USER}' bukan anggota grup sudo"
  if command -v docker >/dev/null 2>&1; then
    id -nG "$DEPLOY_USER" | grep -qw docker && pass "'${DEPLOY_USER}' anggota grup docker" || fail "'${DEPLOY_USER}' bukan anggota grup docker"
  fi
else
  fail "user '${DEPLOY_USER}' tidak ada"
fi
AUTH_KEYS="/home/${DEPLOY_USER}/.ssh/authorized_keys"
if [[ -s "$AUTH_KEYS" ]]; then
  pass "$(grep -cvE '^\s*($|#)' "$AUTH_KEYS") public key terpasang di ${AUTH_KEYS}"
  [[ "$(stat -c '%a' "$AUTH_KEYS")" == "600" ]] && pass "permission ${AUTH_KEYS} = 600" || warn "permission ${AUTH_KEYS} = $(stat -c '%a' "$AUTH_KEYS") (harus 600)"
  [[ "$(stat -c '%U' "$AUTH_KEYS")" == "$DEPLOY_USER" ]] && pass "owner authorized_keys = ${DEPLOY_USER}" || warn "owner $(stat -c '%U' "$AUTH_KEYS") bukan ${DEPLOY_USER}"
else
  fail "tidak ada public key di ${AUTH_KEYS} — login user deploy belum bisa"
fi

sect "Hardening SSH"
SSHD_CONF="/etc/ssh/sshd_config.d/99-mealchain-hardening.conf"
if [[ -f "$SSHD_CONF" ]]; then
  pass "file hardening ada: ${SSHD_CONF}"
  if grep -qiE '^[[:space:]]*Port[[:space:]]' "$SSHD_CONF"; then
    warn "drop-in menulis direktif Port — berpotensi memindahkan port SSH (risiko terkunci)"
  else
    pass "drop-in tidak menyentuh direktif Port (aman)"
  fi
  if command -v sshd >/dev/null 2>&1; then
    EFF="$(sshd -T 2>/dev/null || true)"
    if [[ -n "$EFF" ]]; then
      echo "$EFF" | grep -qi '^passwordauthentication no' && pass "PasswordAuthentication efektif: no" || fail "PasswordAuthentication masih yes"
      echo "$EFF" | grep -qi '^permitrootlogin no' && pass "PermitRootLogin efektif: no" || fail "PermitRootLogin masih diizinkan"
      echo "$EFF" | grep -qi '^pubkeyauthentication yes' && pass "PubkeyAuthentication efektif: yes" || fail "PubkeyAuthentication tidak yes"
    else
      warn "sshd -T gagal dijalankan di lingkungan ini"
    fi
  else
    skip "binary sshd tidak ada — tidak bisa cek konfigurasi efektif"
  fi
else
  fail "hardening SSH belum dipasang (${SSHD_CONF} tidak ada) — kemungkinan belum ada key saat setup"
fi

sect "Firewall (ufw)"
# Port SSH diambil dari sshd sendiri, bukan dari argumen: firewall yang membuka port
# salah = terkunci di luar VPS.
SSH_PORTS_CHECK=""
if command -v sshd >/dev/null 2>&1; then
  SSH_PORTS_CHECK="$(sshd -T 2>/dev/null | awk '/^port /{print $2}' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
fi
[[ -n "$SSH_PORTS_CHECK" ]] || SSH_PORTS_CHECK="$SSH_PORT"
if command -v ufw >/dev/null 2>&1; then
  if ufw status 2>/dev/null | grep -q "Status: active"; then
    pass "ufw aktif"
    for sp in $SSH_PORTS_CHECK; do
      ufw status 2>/dev/null | grep -qE "^${sp}/tcp\b" && pass "rule ${sp}/tcp (ssh) ada" || fail "rule ${sp}/tcp (ssh) TIDAK ada — risiko terkunci"
    done
    for p in 80/tcp 443/tcp; do
      ufw status 2>/dev/null | grep -qE "^${p//\//\\/}\b" && pass "rule ${p} ada" || fail "rule ${p} TIDAK ada"
    done
    for p in 3000 8000 5432; do
      ufw status 2>/dev/null | grep -qE "^${p}(/tcp)?\b.*ALLOW" && warn "port ${p} terbuka ke publik — seharusnya hanya lewat reverse proxy"
    done
    DFLT="$(ufw status verbose 2>/dev/null | awk -F': ' '/Default/{print $2}')"
    echo "$DFLT" | grep -q "deny (incoming)" && pass "default incoming: deny (${DFLT})" || warn "default incoming bukan deny: ${DFLT}"
  else
    fail "ufw tidak aktif"
  fi
else
  fail "ufw tidak terpasang"
fi

sect "fail2ban & security update"
if command -v fail2ban-client >/dev/null 2>&1; then
  if has_systemd; then
    fail2ban-client status >/dev/null 2>&1 && pass "fail2ban berjalan" || fail "fail2ban tidak berjalan"
    fail2ban-client status sshd >/dev/null 2>&1 && pass "jail 'sshd' aktif" || fail "jail 'sshd' tidak aktif"
  else
    skip "fail2ban tidak bisa dicek (tanpa systemd)"
  fi
  [[ -f /etc/fail2ban/jail.d/mealchain-sshd.conf ]] && pass "jail config mealchain-sshd.conf ada" || warn "jail config mealchain-sshd.conf tidak ada"
else
  fail "fail2ban-client tidak ada"
fi
if [[ -f /etc/apt/apt.conf.d/20auto-upgrades ]]; then
  grep -q 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades && pass "security update otomatis aktif" || warn "unattended-upgrades tidak diaktifkan"
else
  fail "20auto-upgrades tidak ada"
fi

sect "Docker"
if command -v docker >/dev/null 2>&1; then
  pass "$(docker --version 2>&1)"
  if docker compose version >/dev/null 2>&1; then pass "compose plugin: $(docker compose version --short 2>/dev/null)"; else fail "docker compose plugin tidak ada"; fi
  if docker info >/dev/null 2>&1; then
    pass "daemon docker merespons"
  elif has_systemd; then
    fail "daemon docker tidak merespons (cek: systemctl status docker)"
  else
    skip "daemon docker tidak dicek (tanpa systemd)"
  fi
else
  fail "docker tidak terpasang"
fi
if [[ -f /etc/docker/daemon.json ]] && grep -q '"max-size"' /etc/docker/daemon.json; then
  pass "log rotation Docker terkonfigurasi ($(tr -d '\n ' < /etc/docker/daemon.json))"
else
  warn "log rotation Docker belum dikonfigurasi — disk bisa penuh"
fi

sect "Direktori proyek"
if [[ -d "$PROJECT_ROOT" ]]; then
  pass "${PROJECT_ROOT} ada (owner $(stat -c '%U:%G' "$PROJECT_ROOT"), mode $(stat -c '%a' "$PROJECT_ROOT"))"
  [[ "$(stat -c '%a' "$PROJECT_ROOT")" == "750" ]] || warn "mode ${PROJECT_ROOT} bukan 750"
else
  fail "${PROJECT_ROOT} tidak ada"
fi
[[ -f /etc/sudoers.d/90-mealchain-deploy ]] && pass "sudoers ringkas ada" || warn "sudoers ringkas tidak ada"

sect "Belum selesai (jika memang belum dikerjakan, wajar)"
if ss -ltn 2>/dev/null | grep -qE ':3000\b'; then pass "frontend listen di 3000"; else warn "tidak ada service di port 3000 (frontend belum di-deploy)"; fi
if ss -ltn 2>/dev/null | grep -qE ':8000\b'; then pass "backend listen di 8000"; else warn "tidak ada service di port 8000 (backend belum di-deploy)"; fi
if ss -ltn 2>/dev/null | grep -qE ':443\b'; then pass "reverse proxy listen di 443 (HTTPS)"; else warn "belum ada reverse proxy di 443 (Caddy/nginx belum dipasang)"; fi
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  warn "PERIKSA MANUAL bahwa ${PROJECT_ROOT}/.env ada di .gitignore dan tidak pernah ter-commit"
else
  warn "${PROJECT_ROOT}/.env belum ada"
fi

echo
if [[ "$FAILS" -gt 0 ]]; then
  printf '%sHASIL: %d pemeriksaan GAGAL%s — perbaiki sebelum lanjut.\n' "$R" "$FAILS" "$N"
  exit 1
fi
printf '%sHASIL: tidak ada FAIL. Cek baris WARN di atas untuk langkah manual.%s\n' "$G" "$N"
exit 0
