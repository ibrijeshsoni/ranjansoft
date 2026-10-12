#!/usr/bin/env bash
# Pulls the latest RanjanSoft images; if one changed (or a container is missing),
# recreates the containers, health-checks the API and rolls back on failure.
# Run every 5 minutes by ranjansoft-update.timer (see install.sh); safe to run by hand.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

log() { echo "[$(date -Is)] $*"; }

[ -f .env ] || { log "deploy/.env is missing: copy ../.env.example to deploy/.env and fill it in."; exit 1; }
set -a; . ./.env; set +a

PREFIX="${IMAGE_PREFIX:-ghcr.io/ibrijeshsoni}"
TAG="${IMAGE_TAG:-latest}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:10105/api/health}"
IMAGES=("$PREFIX/ranjansoft-web:$TAG" "$PREFIX/ranjansoft-api:$TAG")
CONTAINERS=(ranjansoft-web ranjansoft-api)   # same order as IMAGES
COMPOSE=(podman-compose -f podman-compose.server.yml)
BAD_LIST=.bad-images   # image IDs that failed their health check; never deployed again

image_id() { podman image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
# Image the container is actually running (falls back to the local tag when it isn't running).
running_id() { podman container inspect --format '{{.Image}}' "$2" 2>/dev/null || image_id "$1"; }
healthy() {   # up to HEALTH_TIMEOUT seconds (default 60)
  local deadline=$((SECONDS + ${HEALTH_TIMEOUT:-60}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
recreate() { "${COMPOSE[@]}" up -d --force-recreate >/dev/null 2>&1; }

declare -A old
changed=0
for i in "${!IMAGES[@]}"; do
  img=${IMAGES[$i]}
  old[$img]=$(running_id "$img" "${CONTAINERS[$i]}")
  if ! podman pull -q --tls-verify="${REGISTRY_TLS_VERIFY:-true}" "$img" >/dev/null; then
    log "Pull failed for $img. If the GHCR package is private, run 'podman login ghcr.io' with a token that has read:packages, or make the package public."
    exit 1
  fi
  new=$(image_id "$img")
  if [ -f "$BAD_LIST" ] && grep -qx "$new" "$BAD_LIST"; then
    log "Skipping $img: image ${new:0:12} failed its health check before. Push a fixed commit."
    if [ -n "${old[$img]}" ]; then podman tag "${old[$img]}" "$img"; fi
    exit 0
  fi
  if [ "$new" != "${old[$img]}" ]; then changed=1; fi
done

running=$(podman ps --filter name='^ranjansoft-(web|api)$' --format '{{.Names}}' | wc -l)
[ "$changed" -eq 0 ] && [ "$running" -eq 2 ] && exit 0

log "Deploying (new images: $([ $changed -eq 1 ] && echo yes || echo no), running containers: $running/2)"
recreate
if healthy; then
  log "Deploy OK: $HEALTH_URL is healthy"
  podman image prune -f >/dev/null
  exit 0
fi

log "Health check failed at $HEALTH_URL"
rolled=0
for img in "${IMAGES[@]}"; do
  new=$(image_id "$img")
  if [ -n "${old[$img]}" ] && [ "$new" != "${old[$img]}" ]; then
    echo "$new" >> "$BAD_LIST"
    podman tag "${old[$img]}" "$img"
    rolled=1
  fi
done
if [ "$rolled" -eq 1 ]; then
  recreate
  if healthy; then log "Rolled back to the previous images"; else log "Rollback is unhealthy too; check 'podman logs ranjansoft-api'"; fi
else
  log "Nothing to roll back to; check 'podman logs ranjansoft-api'"
fi
exit 1
