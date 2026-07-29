#!/usr/bin/env bash
#
# Deploy on the server. Pulls the image GitHub Actions built, restarts, verifies.
# Run it FROM the checkout on the server:  cd ~/spree && ./script/deploy.sh
#
# It never builds anything — see .github/workflows/deploy.yml for why.
# Full walkthrough: docs/DEPLOY.md

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
PORT="${SPREE_PORT:-3010}"
HEALTH="http://127.0.0.1:${PORT}/up"

cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f .env ]] || die ".env missing. Copy .env.production.example to .env and fill it in."

# Refuse to run with placeholder secrets still in place.
if grep -qE '^(SECRET_KEY_BASE|MISSION_CONTROL_PASSWORD)=(CHANGE_ME|$)' .env; then
  die ".env still has placeholder values. Fill SECRET_KEY_BASE and MISSION_CONTROL_PASSWORD."
fi

say "Current commit"
git log --oneline -1 || true

say "Pulling latest code"
git pull --ff-only

say "Pulling image"
docker compose -f "$COMPOSE_FILE" pull

# Snapshot the DB before migrations run. The image entrypoint runs db:prepare on
# boot, so by the time the new container is up the schema has already changed —
# there is no "after the fact" moment to take this.
if docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -q postgres; then
  say "Backing up database"
  mkdir -p backups
  STAMP="$(date +%Y%m%d-%H%M%S)"
  if docker compose -f "$COMPOSE_FILE" exec -T postgres \
       pg_dump -U postgres spree_production | gzip > "backups/pre-deploy-${STAMP}.sql.gz"; then
    echo "  wrote backups/pre-deploy-${STAMP}.sql.gz"
    ls -1t backups/pre-deploy-*.sql.gz | tail -n +8 | xargs -r rm --   # keep 7
  else
    rm -f "backups/pre-deploy-${STAMP}.sql.gz"
    die "pg_dump failed — refusing to deploy over a database with no backup."
  fi
else
  say "Postgres not running yet — first deploy, nothing to back up"
fi

say "Starting containers (migrations run from the image entrypoint)"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

say "Waiting for health at ${HEALTH}"
for i in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH" || true)"
  if [[ "$code" == "200" ]]; then
    echo "  healthy after $((i * 5))s"
    break
  fi
  if [[ $i -eq 40 ]]; then
    echo
    echo "--- last 60 log lines ---"
    docker compose -f "$COMPOSE_FILE" logs --tail=60 web || true
    die "app did not become healthy (last HTTP code: ${code:-none})"
  fi
  sleep 5
done

say "Cleaning old images"
docker image prune -f --filter "until=168h" >/dev/null || true

say "Running containers"
docker compose -f "$COMPOSE_FILE" ps

say "Memory"
free -m | head -2

printf '\n\033[1;32mDeployed OK\033[0m  →  https://%s/admin\n\n' "${RAILS_HOST:-spree.b-teka.com}"
