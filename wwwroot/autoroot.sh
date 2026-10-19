#!/bin/sh

# local replacement for SlopBro's autoroot.sh
# rooting already done in earlier runs; this pass just plants durable access:
#   - ssh authorized_keys (jef@tv-root)
#   - HB Channel's dropbear on :2222 (with its hostkey dir created)
#   - webosbrew sshd boot flag (harmless if their boot chain is absent)

mkdir -p /home/root/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJl8DuTS/qQhJz48HckvgS/M05bpjou6mI/7PnM/bQtB jef@tv-root' > /home/root/.ssh/authorized_keys
chmod 700 /home/root/.ssh
chmod 600 /home/root/.ssh/authorized_keys
chown -R 0:0 /home/root/.ssh

mkdir -p /var/lib/webosbrew/sshd
touch /var/luna/preferences/webosbrew_sshd_enabled

H=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service
nohup "$H/bin/dropbear" -R -E -p 2222 >/tmp/dropbear.log 2>&1 &
RC=$?

echo "setup done rc=$RC key=$(wc -c < /home/root/.ssh/authorized_keys) dropbearpid=$(pidof dropbear)" > /tmp/setup.log 2>&1
