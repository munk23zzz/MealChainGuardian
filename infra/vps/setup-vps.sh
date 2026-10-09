#!/usr/bin/env bash
# =============================================================================
# MealChain Guardian — VPS bootstrap (Ubuntu 22.04 / 24.04 LTS)
# =============================================================================
# Menyiapkan VPS dari kondisi kosong menjadi siap-deploy:
#   swap -> paket dasar -> timezone -> user deploy (+SSH key) -> hardening SSH
#   -> firewall -> fail2ban -> unattended-upgrades -> Docker Engine + compose
#   -> direktori proyek -> log rotation Docker
#
# Sifat: IDEMPOTENT. Aman dijalankan berulang; setiap langkah dicek dulu.
# Jangan pernah "menghapus" konfigurasi yang sudah ada: file yang akan ditimpa
# selalu di-backup ke <file>.bak.<timestamp>.
#
# Pemakaian:
#   sudo bash setup-vps.sh --ssh-key-file /root/mykey.pub
#   sudo bash setup-vps.sh --dry-run                 # lihat rencana, tanpa ubah apa pun
#   sudo bash setup-vps.sh --hostname mealchain-vps --install-node
#
# PENTING (baca sebelum menjalankan):
#   1. Script akan mematikan login password SSH. Pastikan user deploy SUDAH punya
#      public key terpasang. Kalau tidak ada key yang bisa dipasang, script
#      OTOMATIS MELEWATI hardening SSH (tidak akan mengunci Anda di luar).
#   2. Firewall rule untuk port SSH dipasang SEBELUM ufw diaktifkan.
#   3. Verifikasi hasilnya dengan: sudo bash verify-vps.sh
# =============================================================================
set -Eeuo pipefail

# ---------------------------------------------------------------- default ---
DRY_RUN=0
DEPLOY_USER="deploy"
SSH_KEY_FILE=""
SSH_PORT="22"
SSH_PORT_SET=0
NEW_HOSTNAME=""
SWAP_SIZE="2G"
SKIP_SWAP=0
HARDEN_SSH=1
INSTALL_NODE=0
PROJECT_ROOT="/srv/mealchain"
LOG_FILE="/var/log/mealchain-bootstrap.log"

# ------------------------------------------------------------------ warna ---
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_STEP=$'\033[36m'
else
  C_RESET=""; C_OK=""; C_WARN=""; C_ERR=""; C_STEP=""
fi

WARNINGS=0
SKIPPED=0
CHANGED=0

log()   { printf '%s[ .. ]%s %s\n' "$C_STEP" "$C_RESET" "$*"; }
ok()    { printf '%s[ ok ]%s %s\n' "$C_OK" "$C_RESET" "$*"; }
skip()  { printf '%s[skip]%s %s\n' "$C_WARN" "$C_RESET" "$*"; SKIPPED=$((SKIPPED+1)); }
warn()  { printf '%s[warn]%s %s\n' "$C_WARN" "$C_RESET" "$*" >&2; WARNINGS=$((WARNINGS+1)); }
die()   { printf '%s[fail]%s %s\n' "$C_ERR" "$C_RESET" "$*" >&2; exit 1; }

# Jalankan (atau cetak) perintah. Semua mutasi sistem lewat sini.
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '       dry-run: %s\n' "$*"
    return 0
  fi
  "$@"
}

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1; shift ;;
    --deploy-user)    DEPLOY_USER="${2:?}"; shift 2 ;;
    --ssh-key-file)   SSH_KEY_FILE="${2:?}"; shift 2 ;;
    --ssh-port)       SSH_PORT="${2:?}"; SSH_PORT_SET=1; shift 2 ;;
    --hostname)       NEW_HOSTNAME="${2:?}"; shift 2 ;;
    --swap-size)      SWAP_SIZE="${2:?}"; shift 2 ;;
    --skip-swap)      SKIP_SWAP=1; shift ;;
    --no-ssh-harden)  HARDEN_SSH=0; shift ;;
    --install-node)   INSTALL_NODE=1; shift ;;
    --project-root)   PROJECT_ROOT="${2:?}"; shift 2 ;;
    -h|--help)        usage ;;
    *) die "Flag tidak dikenal: $1 (pakai --help)" ;;
  esac
done

[[ "$(id -u)" == "0" ]] || die "Harus dijalankan sebagai root: sudo bash $0"

# Perintah yang dijalankan lewat sudo oleh user ini (untuk mengambil SSH key).
CALLER_USER="${SUDO_USER:-root}"

if [[ "$DRY_RUN" != "1" ]]; then
  touch "$LOG_FILE"; exec > >(tee -a "$LOG_FILE") 2>&1
fi
echo "=== MealChain Guardian VPS bootstrap — $(date -Is) ==="

has_systemd() { [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; }
svc_enable_start() {
  local unit="$1"
  if has_systemd; then run systemctl enable --now "$unit" || warn "gagal enable/start $unit"
  else skip "systemd tidak tersedia — lewati systemctl enable --now $unit (normal di container)"; fi
}
svc_restart() {
  local unit="$1"
  if has_systemd; then run systemctl restart "$unit" || warn "gagal restart $unit"
  else skip "systemd tidak tersedia — lewati restart $unit"; fi
}

backup_if_exists() {
  local f="$1"
  [[ -e "$f" ]] || return 0
  run cp -a "$f" "$f.bak.$(date +%Y%m%d%H%M%S)"
}

# ============================================================ 1. preflight ===
log "1/10 Preflight: identifikasi OS"
if [[ ! -r /etc/os-release ]]; then
  die "Tidak bisa baca /etc/os-release — bukan distro Linux yang dikenal."
fi
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "Script ini untuk Ubuntu, terdeteksi: ${ID:-unknown}. Hentikan dan sesuaikan manual."
case "${VERSION_ID:-}" in
  22.04|24.04|26.04) ok "Ubuntu ${VERSION_ID} (${PRETTY_NAME})" ;;
  *) warn "Ubuntu ${VERSION_ID} belum diuji; lanjut dengan risiko sendiri." ;;
esac
ok "CPU: $(nproc) core, RAM: $(free -m | awk '/^Mem:/{print $2}') MB, disk /: $(df -h / | awk 'NR==2{print $4}') bebas"
if [[ "$(nproc)" -le 2 && "$(free -m | awk '/^Mem:/{print $2}')" -le 2600 ]]; then
  warn "VPS 2 vCPU / 2 GB: build Next.js DI VPS berisiko OOM. Disarankan build image di CI, VPS hanya jalankan container."
fi

# ================================================================= 2. swap ===
log "2/10 Swap (wajib di VPS 2 GB)"
SWAP_ACTIVE=0
if [[ "$SKIP_SWAP" == "1" ]]; then
  skip "swap dilewati (--skip-swap)"
elif swapon --show=NAME --noheadings 2>/dev/null | grep -q .; then
  ok "swap sudah aktif: $(swapon --show=SIZE --noheadings 2>/dev/null | tr -d ' ' | paste -sd, -)"
else
  if [[ "$DRY_RUN" != "1" ]]; then
    if fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null; then :; else
      warn "fallocate gagal (filesystem tidak mendukung) — fallback ke dd"
      dd if=/dev/zero of=/swapfile bs=1M count="$(numfmt --from=iec "$SWAP_SIZE" | awk '{print $1/1048576}')" status=none \
        || die "gagal membuat /swapfile"
    fi
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    if swapon /swapfile; then
      SWAP_ACTIVE=1
    else
      SWAP_ACTIVE=0
      warn "swapon gagal (kernel/lingkungan tidak mendukung swap) — swap TIDAK aktif; ulangi di VPS sungguhan"
      rm -f /swapfile
    fi
  else
    run fallocate -l "$SWAP_SIZE" /swapfile; run chmod 600 /swapfile; run mkswap /swapfile; run swapon /swapfile
    SWAP_ACTIVE=1
  fi
  if [[ "$SWAP_ACTIVE" == "1" ]]; then
    if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab 2>/dev/null; then
      backup_if_exists /etc/fstab
      run bash -c 'printf "/swapfile none swap sw 0 0\n" >> /etc/fstab'
    fi
    if [[ -f /etc/sysctl.d/99-mealchain-swap.conf ]]; then
      skip "tuning swappiness sudah ada"
    else
      run bash -c 'printf "vm.swappiness=10\nvm.vfs_cache_pressure=50\n" > /etc/sysctl.d/99-mealchain-swap.conf'
      has_systemd && run sysctl --system >/dev/null 2>&1 || true
    fi
    CHANGED=$((CHANGED+1))
    ok "swap ${SWAP_SIZE} dibuat + permanen di /etc/fstab"
  fi
fi

# ============================================================ 3. paket dasar =
log "3/10 Paket dasar"
export DEBIAN_FRONTEND=noninteractive
run apt-get update -qq
run apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release apt-transport-https sudo \
  git jq unzip htop ufw fail2ban unattended-upgrades \
  chrony net-tools
ok "paket dasar terpasang"

# ======================================================= 4. waktu & hostname =
log "4/10 Timezone + hostname"
TZ_TARGET="Asia/Jakarta"
if [[ "$(timedatectl show -p Timezone --value 2>/dev/null || echo '')" == "$TZ_TARGET" ]]; then
  ok "timezone sudah ${TZ_TARGET}"
elif run timedatectl set-timezone "$TZ_TARGET" 2>/dev/null; then
  ok "timezone -> ${TZ_TARGET}"
else
  run ln -sf "/usr/share/zoneinfo/${TZ_TARGET}" /etc/localtime
  run bash -c "printf '%s\n' '${TZ_TARGET}' > /etc/timezone"
  warn "timedatectl tidak bisa dipakai (tanpa systemd?) — timezone diatur lewat /etc/localtime + /etc/timezone"
  ok "timezone -> ${TZ_TARGET} (fallback)"
fi
if [[ -n "$NEW_HOSTNAME" ]]; then
  if [[ "$(hostname)" == "$NEW_HOSTNAME" ]]; then
    ok "hostname sudah $NEW_HOSTNAME"
  else
    run hostnamectl set-hostname "$NEW_HOSTNAME" 2>/dev/null || warn "tidak bisa set hostname (container?)"
    ok "hostname -> $NEW_HOSTNAME"
  fi
fi

# ======================================================== 5. user deploy =====
log "5/10 User deploy: ${DEPLOY_USER}"
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  ok "user ${DEPLOY_USER} sudah ada"
else
  run useradd -m -s /bin/bash "$DEPLOY_USER"
  ok "user ${DEPLOY_USER} dibuat"
fi
run usermod -aG sudo "$DEPLOY_USER" || warn "gagal tambah ke grup sudo"
run install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"

# ================================================= 6. SSH key + hardening ====
log "6/10 SSH key + hardening"
AUTH_KEYS="/home/${DEPLOY_USER}/.ssh/authorized_keys"
KEY_SOURCES=()
[[ -n "$SSH_KEY_FILE" ]] && KEY_SOURCES+=("$SSH_KEY_FILE")
if [[ "$CALLER_USER" != "root" && -r "/home/${CALLER_USER}/.ssh/authorized_keys" ]]; then
  KEY_SOURCES+=("/home/${CALLER_USER}/.ssh/authorized_keys")
fi
[[ -r /root/.ssh/authorized_keys ]] && KEY_SOURCES+=("/root/.ssh/authorized_keys")

INSTALLED_KEYS=0
if [[ "$DRY_RUN" != "1" ]]; then
  for src in "${KEY_SOURCES[@]:-}"; do
    [[ -r "$src" ]] || continue
    while IFS= read -r line; do
      [[ -z "$line" || "$line" == \#* ]] && continue
      if ! grep -qxF "$line" "$AUTH_KEYS" 2>/dev/null; then printf '%s\n' "$line" >> "$AUTH_KEYS"; fi
      INSTALLED_KEYS=$((INSTALLED_KEYS+1))
    done < "$src"
  done
  [[ -s "$AUTH_KEYS" ]] && { chmod 600 "$AUTH_KEYS"; chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH_KEYS"; }
fi
if [[ "$DRY_RUN" == "1" ]]; then
  ok "akan memasang public key dari: ${KEY_SOURCES[*]:-<tidak ada>}"
elif [[ "$INSTALLED_KEYS" -gt 0 ]]; then
  ok "${INSTALLED_KEYS} public key ada di ${AUTH_KEYS}"
else
  warn "TIDAK ADA public key ditemukan untuk ${DEPLOY_USER}."
fi

SSHD_CONF="/etc/ssh/sshd_config.d/99-mealchain-hardening.conf"
SSH_READY=0
if [[ "$DRY_RUN" == "1" || -s "$AUTH_KEYS" ]]; then
  SSH_READY=1
fi

# Port SSH efektif: dibaca dari sshd sendiri, bukan dari asumsi. Menulis port yang
# salah ke konfigurasi + restart = cara paling cepat mengunci diri di luar VPS.
SSH_PORTS=""
DETECTED_PORTS=""
if command -v sshd >/dev/null 2>&1; then
  DETECTED_PORTS="$(sshd -T 2>/dev/null | awk '/^port /{print $2}' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
fi
if [[ -n "$DETECTED_PORTS" ]]; then
  SSH_PORTS="$DETECTED_PORTS"
  if [[ "$SSH_PORT_SET" == "1" ]] && ! echo " $SSH_PORTS " | grep -q " ${SSH_PORT} "; then
    warn "sshd efektif listen di port: ${SSH_PORTS} — Anda meminta ${SSH_PORT}."
    warn "  Script TIDAK mengubah port sshd (perubahan port = risiko terkunci)."
    warn "  Firewall akan memakai port hasil deteksi (${SSH_PORTS}), bukan yang diminta."
  fi
else
  SSH_PORTS="$SSH_PORT"
fi
SSHD_LISTENING=0
for p in $SSH_PORTS; do
  ss -ltn 2>/dev/null | grep -qE ":${p}[[:space:]]" && SSHD_LISTENING=1
done

if [[ "$HARDEN_SSH" == "0" ]]; then
  skip "hardening SSH dilewati (--no-ssh-harden)"
elif [[ "$SSH_READY" != "1" ]]; then
  warn "Hardening SSH DILEWATI: belum ada public key untuk ${DEPLOY_USER}."
  warn "  Pasang key dulu, lalu jalankan ulang: sudo bash $0 --ssh-key-file /root/key.pub"
  warn "  (Ini disengaja: mematikan password auth tanpa key = Anda terkunci di luar VPS.)"
elif [[ "$DRY_RUN" != "1" && "$SSHD_LISTENING" != "1" ]]; then
  skip "sshd tidak listen di port ${SSH_PORTS} — hardening tidak dipasang (menghindari konfigurasi yang tidak bisa diverifikasi)"
else
  backup_if_exists "$SSHD_CONF"
  run install -d -m 755 /etc/ssh/sshd_config.d
  if [[ "$DRY_RUN" != "1" ]]; then
    cat > "$SSHD_CONF" <<EOF
# MealChain Guardian — dikelola setup-vps.sh. Jangan edit manual tanpa alasan.
# Direktif Port sengaja TIDAK ditulis di sini: port tetap dikelola sshd_config
# utama, supaya script ini tidak pernah bisa memindahkan port SSH diam-diam.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 4
EOF
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    ok "akan menulis ${SSHD_CONF} (PasswordAuthentication no, PermitRootLogin no; port TIDAK diubah: ${SSH_PORTS})"
  elif command -v sshd >/dev/null 2>&1 && sshd -t 2>/dev/null; then
    svc_restart ssh
    ok "sshd_config valid; password login dimatikan (port tetap ${SSH_PORTS})"
  else
    warn "sshd -t gagal — konfigurasi baru TIDAK diaktifkan. Cek: sudo sshd -t"
    run rm -f "$SSHD_CONF"
  fi
fi

# ============================================================ 7. firewall ====
log "7/10 Firewall (ufw)"
if ! command -v ufw >/dev/null 2>&1; then
  warn "ufw tidak ada — lewati firewall"
elif ufw status 2>/dev/null | grep -q "Status: active"; then
  ok "ufw sudah aktif: $(ufw status | awk '/^[0-9]/{print $1"/"$3}' | paste -sd' ' -)"
else
  # Urutan KRITIS: izinkan SSH dulu, baru enable. Port diambil dari hasil deteksi sshd.
  UFW_OK=1
  for p in $SSH_PORTS; do
    run ufw allow "${p}/tcp" comment 'ssh' || { UFW_OK=0; warn "gagal menambah rule SSH port ${p}"; }
  done
  [[ "$UFW_OK" == "1" ]] || warn "rule SSH gagal ditambahkan — MEMBATALKAN aktivasi ufw agar Anda tidak terkunci"
  run ufw allow 80/tcp comment 'http'   || UFW_OK=0
  run ufw allow 443/tcp comment 'https' || UFW_OK=0
  run ufw default deny incoming  || UFW_OK=0
  run ufw default allow outgoing || UFW_OK=0
  if [[ "$UFW_OK" == "1" ]]; then
    if run ufw --force enable; then
      ok "ufw aktif (allow ${SSH_PORTS}, 80, 443; deny sisanya)"
    else
      warn "ufw --force enable gagal (iptables/nf_tables tidak tersedia?) — firewall TIDAK aktif"
    fi
  else
    warn "beberapa rule ufw gagal ditambahkan — ufw TIDAK diaktifkan. Cek manual: ufw status verbose"
  fi
fi
warn "Port 3000/8000/5432 sengaja TIDAK dibuka — akses lewat reverse proxy (Caddy/nginx) saja."

# ============================================================= 8. fail2ban ===
log "8/10 fail2ban + unattended-upgrades"
FB_JAIL="/etc/fail2ban/jail.d/mealchain-sshd.conf"
if [[ -f "$FB_JAIL" ]]; then
  ok "jail fail2ban untuk sshd sudah ada"
elif command -v fail2ban-server >/dev/null 2>&1 || [[ -d /etc/fail2ban ]]; then
  if [[ "$DRY_RUN" != "1" ]]; then
    cat > "$FB_JAIL" <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  fi
  svc_enable_start fail2ban
  ok "fail2ban aktif untuk sshd (maxretry 5, bantime 1h)"
else
  warn "fail2ban tidak terpasang dengan benar"
fi
if [[ -f /etc/apt/apt.conf.d/20auto-upgrades ]]; then
  skip "unattended-upgrades sudah terkonfigurasi"
else
  if [[ "$DRY_RUN" != "1" ]]; then
    printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
  fi
  run dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || warn "dpkg-reconfigure unattended-upgrades gagal"
  ok "security update otomatis aktif"
fi
svc_enable_start chrony >/dev/null 2>&1 || true

# =============================================================== 9. Docker ===
log "9/10 Docker Engine + compose plugin (repo resmi Docker)"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "docker + compose plugin sudah ada: $(docker --version 2>/dev/null)"
else
  run install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    if [[ "$DRY_RUN" != "1" ]]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
        || die "gagal unduh GPG key Docker (cek koneksi/DNS)"
      chmod a+r /etc/apt/keyrings/docker.asc
    else
      run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    fi
  fi
  ARCH="$(dpkg --print-architecture)"
  CODENAME_OD="${VERSION_CODENAME:-$(. /etc/os-release; echo "$VERSION_CODENAME")}"
  if [[ "$DRY_RUN" != "1" ]]; then
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$ARCH" "$CODENAME_OD" > /etc/apt/sources.list.d/docker.list
  fi
  run apt-get update -qq
  run apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    || die "instalasi Docker gagal"
  svc_enable_start docker
  run usermod -aG docker "$DEPLOY_USER" || warn "gagal tambah ${DEPLOY_USER} ke grup docker (login ulang diperlukan setelah ini)"
  ok "Docker terpasang; ${DEPLOY_USER} masuk grup docker (efektif setelah login ulang)"
fi

# Log rotation Docker: jangan menimpa konfigurasi lain yang sudah ada.
DAEMON_JSON="/etc/docker/daemon.json"
if [[ -f "$DAEMON_JSON" ]] && grep -q '"max-size"' "$DAEMON_JSON" 2>/dev/null; then
  skip "log rotation Docker sudah dikonfigurasi"
elif [[ "$DRY_RUN" != "1" ]] && command -v python3 >/dev/null 2>&1; then
  mkdir -p /etc/docker
  backup_if_exists "$DAEMON_JSON"
  python3 - "$DAEMON_JSON" <<'PY'
import json, os, sys
p = sys.argv[1]
data = {}
if os.path.exists(p):
    try:
        data = json.load(open(p))
    except Exception:
        data = {}
data.setdefault("log-driver", "json-file")
opts = data.setdefault("log-opts", {})
opts.setdefault("max-size", "10m")
opts.setdefault("max-file", "3")
json.dump(data, open(p, "w"), indent=2)
print("daemon.json log-opts ->", opts)
PY
  svc_restart docker
  ok "log rotation Docker: json-file max-size 10m, max-file 3"
else
  skip "log rotation Docker dilewati (butuh python3 atau dry-run)"
fi

if [[ "$INSTALL_NODE" == "1" ]]; then
  if command -v node >/dev/null 2>&1; then
    ok "node sudah ada: $(node -v)"
  else
    run bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -'
    run apt-get install -y -qq nodejs
    ok "Node.js 20 LTS terpasang: $(node -v 2>/dev/null || echo '?')"
  fi
else
  skip "Node.js tidak dipasang (opsional: --install-node; disarankan build di CI, bukan di VPS 2 GB)"
fi

# ====================================================== 10. direktori proyek =
log "10/10 Direktori proyek + sudoers ringkas"
run install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$PROJECT_ROOT"
run install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "${PROJECT_ROOT}/backups"
ok "${PROJECT_ROOT} siap (owner ${DEPLOY_USER}, mode 750)"

SUDOERS_FILE="/etc/sudoers.d/90-mealchain-deploy"
if ! command -v visudo >/dev/null 2>&1; then
  warn "visudo tidak tersedia (paket sudo tidak ada) — sudoers ringkas dilewati"
elif [[ -f "$SUDOERS_FILE" ]]; then
  skip "sudoers ringkas sudah ada"
elif [[ "$DRY_RUN" != "1" ]]; then
  install -d -m 755 /etc/sudoers.d
  if printf '%s ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/systemctl restart docker, /usr/bin/systemctl status docker\n' \
       "$DEPLOY_USER" > "$SUDOERS_FILE" 2>/dev/null \
     && chmod 440 "$SUDOERS_FILE" \
     && visudo -c -f "$SUDOERS_FILE" >/dev/null 2>&1; then
    ok "sudoers ringkas ditambahkan (${SUDOERS_FILE})"
  else
    rm -f "$SUDOERS_FILE"
    warn "sudoers ringkas gagal ditulis/divalidasi — dibatalkan (tidak ada perubahan)"
  fi
else
  ok "dry-run: akan menulis ${SUDOERS_FILE} berisi hak terbatas untuk ${DEPLOY_USER}"
fi

# ============================================================== ringkasan ====
echo
echo "=== Ringkasan ==="
echo "  log          : ${LOG_FILE}"
echo "  user deploy  : ${DEPLOY_USER} (key: ${AUTH_KEYS})"
echo "  proyek       : ${PROJECT_ROOT}"
echo "  swap         : $(swapon --show=SIZE --noheadings 2>/dev/null | tr -d ' ' | paste -sd, - || echo '-')"
echo "  docker       : $(docker --version 2>/dev/null || echo 'belum terpasang')"
echo "  ufw          : $(ufw status 2>/dev/null | head -1 || echo 'tidak ada')"
echo "  warnings     : ${WARNINGS}, skipped: ${SKIPPED}, diubah: ${CHANGED}"
echo
echo "Langkah manual yang MASIH harus Anda lakukan:"
echo "  1. DNS: arahkan app.<domain> dan api.<domain> ke IP VPS ini (sekarang belum ada)."
echo "  2. SSH: dari laptop, tes login user baru SEBELUM menutup sesi root:"
echo "       ssh -p ${SSH_PORT} ${DEPLOY_USER}@<ip-vps>"
echo "  3. Kredensial: simpan .env asli di ${PROJECT_ROOT} (chmod 600, JANGAN ke git)."
echo "     Termasuk kredensial AWS Bedrock dan service key SAP AI Core."
echo "  4. Lanjut ke file produksi: docker-compose.prod.yml, Dockerfile, Caddyfile, deploy.sh."
echo
echo "Verifikasi kondisi VPS: sudo bash $(dirname "$(readlink -f "$0")")/verify-vps.sh"
echo
if [[ "$WARNINGS" -gt 0 ]]; then
  echo "Selesai DENGAN ${WARNINGS} peringatan — baca bagian [warn] di atas." >&2
  exit 2
fi
echo "Selesai tanpa peringatan."
