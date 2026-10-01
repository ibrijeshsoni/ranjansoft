#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  gen-self-signed-cert.sh
#  Generates a self-signed TLS certificate for LOCAL testing.
#  For production, use Let's Encrypt (see README).
# ─────────────────────────────────────────────────────────────

set -euo pipefail

CERT_DIR="$(dirname "$0")/certs"
mkdir -p "$CERT_DIR"

openssl req -x509 \
  -nodes \
  -newkey rsa:4096 \
  -keyout "$CERT_DIR/privkey.pem" \
  -out    "$CERT_DIR/fullchain.pem" \
  -days   365 \
  -subj   "/C=IN/ST=State/L=City/O=Nexcore/CN=localhost"

echo ""
echo "✅  Self-signed cert created in: $CERT_DIR"
echo "    fullchain.pem  →  certificate"
echo "    privkey.pem    →  private key"
echo ""
echo "⚠️   Browser will show a security warning for self-signed certs."
echo "    For production, replace with a Let's Encrypt cert."
