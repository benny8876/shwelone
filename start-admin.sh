# Shwe Lone admin — start local server
set -euo pipefail
cd "$(dirname "$0")"
echo "Starting admin server on http://localhost:8790/admin/"
if [[ -f .env ]]; then
  echo "Loaded config from .env"
fi
node admin-server/server.js
