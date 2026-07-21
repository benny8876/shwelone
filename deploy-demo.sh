#!/usr/bin/env bash
# Share the Stand Law Firm demo locally with a public URL (temporary).
# Requires: python3, ssh

set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"

if ! curl -sf "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  echo "Starting local server on port ${PORT}..."
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  sleep 1
fi

echo ""
echo "Public demo tunnel (keep this terminal open):"
echo "  https://YOUR-URL.lhr.life"
echo ""
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=60 -R "80:127.0.0.1:${PORT}" nokey@localhost.run
