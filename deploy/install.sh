#!/usr/bin/env bash
# One-time setup on stock-market-server, run as the user that will own the containers:
#   git clone https://github.com/ibrijeshsoni/ranjansoft.git && cd ranjansoft/deploy && ./install.sh
# Installs a systemd user timer that runs update.sh every 5 minutes, then deploys once.
set -euo pipefail
here=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)

for cmd in podman podman-compose curl; do
  command -v "$cmd" >/dev/null || { echo "Missing '$cmd'. Install it first (podman-compose: pip install --user podman-compose)."; exit 1; }
done

if [ ! -f "$here/.env" ]; then
  cp "$here/../.env.example" "$here/.env"
  chmod 600 "$here/.env"
  echo "Created $here/.env from .env.example. Fill it in, then run ./install.sh again."
  exit 1
fi

unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
cat > "$unit_dir/ranjansoft-update.service" <<UNIT
[Unit]
Description=Pull and deploy the latest RanjanSoft images
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$here/update.sh
UNIT
cat > "$unit_dir/ranjansoft-update.timer" <<UNIT
[Unit]
Description=Check GHCR for new RanjanSoft images every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now ranjansoft-update.timer
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  loginctl enable-linger "$USER" 2>/dev/null \
    || echo "Run 'sudo loginctl enable-linger $USER' so the timer keeps running after you log out."
fi

echo "Timer installed. Running the first deploy now..."
"$here/update.sh"
echo "Done. Logs: journalctl --user -u ranjansoft-update -f"
