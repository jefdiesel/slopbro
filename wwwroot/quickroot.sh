#!/bin/sh
# Minimal direct-SSH root: sets up authorized_keys and starts dropbear
# Runs as root from jsserver context (after cgroup escape)

set -e

LOG=/tmp/slopbro.log
PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJl8DuTS/qQhJz48HckvgS/M05bpjou6mI/7PnM/bQtB jef@tv-root"

log() { echo "$(date) $*" >> "${LOG}" 2>/dev/null; }

toast() {
    luna-send -w 2000 -n 1 -a 'com.webos.service.secondscreen.gateway' \
        'luna://com.webos.notification/createToast' \
        "{\"sourceId\":\"com.webos.service.secondscreen.gateway\",\"message\":\"$1\"}" \
        >/dev/null 2>/dev/null || true
}

log "quickroot.sh start, pid=$$, id=$(id)"
toast "SlopBro: quickroot starting"

# Setup authorized_keys in multiple candidate locations
for AUTHDIR in /home/root/.ssh /root/.ssh /var/home/root/.ssh; do
    mkdir -p "${AUTHDIR}" 2>/dev/null || true
    echo "${PUBKEY}" > "${AUTHDIR}/authorized_keys" 2>/dev/null && \
        chmod 600 "${AUTHDIR}/authorized_keys" 2>/dev/null || true
done

log "authorized_keys written"

# Generate or reuse dropbear host key
DROPBEAR=/tmp/dropbear
KEYFILE=/tmp/dropbear_host_key

log "preparing dropbear at ${DROPBEAR}"
[ -x "${DROPBEAR}" ] || { log "dropbear missing"; exit 1; }

# Generate host key if not present
"${DROPBEAR}" -R 2>/dev/null || true

# Try to start dropbear in the init network namespace (for LAN access)
if [ -f /proc/1/ns/net ] && command -v nsenter >/dev/null 2>&1; then
    log "using nsenter to enter init network namespace"
    nsenter --net=/proc/1/ns/net -- "${DROPBEAR}" -F -E -p 2222 \
        -A /home/root/.ssh/authorized_keys &
    DBPID=$!
    sleep 1
    kill -0 "${DBPID}" 2>/dev/null && log "dropbear pid=${DBPID} running in init netns" || log "dropbear exited"
else
    # Fallback: try unshare or direct start
    log "nsenter not available, trying direct start"
    "${DROPBEAR}" -F -E -p 2222 -A /home/root/.ssh/authorized_keys &
    log "dropbear started pid=$! (may be wrong netns)"
fi

toast "SlopBro: dropbear started on :2222"
log "quickroot.sh done"
