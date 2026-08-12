#!/usr/bin/env bash
# Back up every shop on this host: database, uploaded files, source and secrets.
#
#   spree-backup              every shop under /srv
#   spree-backup <shop>       one shop, what you run before touching anything
#
# It exists because on 2026-08-12 a postgres volume was recreated to change a
# password and a morning of the client's admin settings went with it. There was
# nothing to restore from. Read that as the standing instruction: dump first.
#
# Four parts per shop, because losing any one of them loses the shop:
#
#   db       pg_dump. Products, orders, customers, and the settings screens that
#            have no row count you would think to check before deleting.
#   storage  the Active Storage volume. Product photography is uploaded, not
#            deployed, so it exists nowhere else. Losing it means asking the
#            client to re-upload their own catalogue.
#   app      /srv/<shop>/app. Mostly reproducible from git, except the client's
#            own mail templates, shipping calculator and postcode list, which are
#            gitignored on purpose and therefore live only on this disk.
#   env      /srv/<shop>/.env. Secrets, so the whole tree is 0700 and so is this.
#
# Every run writes a receipt (last-run.json) whether it succeeds or fails, and
# writes it LAST on success. `script/backups` reads it from outside the box, so a
# silent failure is visible from somewhere other than the machine that failed.
#
# Two refusals worth knowing about:
#
#   * A dump is never trusted on pg_dump's exit code alone. pg_dump exits 0 on a
#     file truncated by a full disk. Size, gzip integrity and the trailing
#     completion marker are all checked by reading the file back.
#   * The retention sweep never removes the newest copy of anything, however old
#     it is. A shop whose backups quietly stopped keeps its last good one rather
#     than ageing out of existence while nobody is looking.

set -uo pipefail

BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/spree}
KEEP_DAYS=${KEEP_DAYS:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STARTED=$(date -u +%s)

log()  { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { printf '%s WARN %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

FAILURES=()

human() { numfmt --to=iec "$1" 2>/dev/null || echo "${1}b"; }
size_of() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0; }

# Write the receipt the outside check reads. Called on every exit path.
receipt() {
  local status=$1 detail=$2
  mkdir -p "$BACKUP_ROOT"
  cat > "$BACKUP_ROOT/last-run.json" <<JSON
{
  "finished_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "finished_epoch": $(date -u +%s),
  "duration_seconds": $(( $(date -u +%s) - STARTED )),
  "status": "$status",
  "detail": "$detail",
  "shops": [$SHOPS_JSON]
}
JSON
  chmod 600 "$BACKUP_ROOT/last-run.json"
}
SHOPS_JSON=""

verify_gz() {
  # $1 file, $2 minimum bytes, $3 label. Reads the file back rather than
  # believing the exit code of whatever produced it.
  local f=$1 min=$2 label=$3 bytes
  bytes=$(size_of "$f")
  if [ "$bytes" -lt "$min" ]; then
    rm -f "$f"; warn "$label: only ${bytes}b, refusing to keep it"; return 1
  fi
  if ! gzip -t "$f" 2>/dev/null; then
    rm -f "$f"; warn "$label: not valid gzip, discarded"; return 1
  fi
  return 0
}

backup_shop() {
  local shop=$1 dir=/srv/$1
  [ -f "$dir/docker-compose.yml" ] || { log "skip $shop, no compose file"; return 0; }

  local out=$BACKUP_ROOT/$shop/$STAMP
  mkdir -p "$out"
  local ok=1 total=0

  # ── database ──────────────────────────────────────────────────────────────
  local db=$out/db.sql.gz
  if (cd "$dir" && docker compose exec -T postgres \
        pg_dump -U postgres --clean --if-exists spree_production) 2>/dev/null | gzip -9 > "$db"; then
    if verify_gz "$db" 10000 "$shop/db"; then
      if zcat "$db" | tail -10 | grep -q 'PostgreSQL database dump complete'; then
        log "  $shop db       $(human "$(size_of "$db")")"
        total=$(( total + $(size_of "$db") ))
      else
        rm -f "$db"; warn "$shop/db: no completion marker, truncated"; ok=0
      fi
    else ok=0; fi
  else
    rm -f "$db"; warn "$shop/db: pg_dump failed"; ok=0
  fi

  # ── uploaded files ────────────────────────────────────────────────────────
  # Read out of the volume through a throwaway container: the files belong to
  # the container's user, and this avoids caring what that uid is on the host.
  local st=$out/storage.tar.gz
  local vol="${shop}_storage_data"
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    if docker run --rm -v "$vol":/v:ro alpine tar -czf - -C /v . > "$st" 2>/dev/null; then
      # An empty storage volume is legitimate on a shop with no photos yet, so
      # the floor here is a valid-gzip check rather than a size one.
      if verify_gz "$st" 20 "$shop/storage"; then
        log "  $shop storage  $(human "$(size_of "$st")")"
        total=$(( total + $(size_of "$st") ))
      else ok=0; fi
    else
      rm -f "$st"; warn "$shop/storage: tar failed"; ok=0
    fi
  else
    log "  $shop storage  (no volume yet)"
  fi

  # ── source, client assets and secrets ─────────────────────────────────────
  # node_modules and .git are excluded: both are large and both come back from
  # a pull. The gitignored client files are the reason this part exists at all.
  # Every --exclude goes BEFORE the directory operand. GNU tar treats these as
  # positional: put them after and they silently match nothing, tar still exits
  # non-zero, and you get a "backup" carrying node_modules and no warning worth
  # reading. Found the hard way.
  local app=$out/app.tar.gz
  if tar -czf "$app" -C /srv \
        --exclude="$shop/app/node_modules" \
        --exclude="$shop/app/storefront/node_modules" \
        --exclude="$shop/app/storefront/.next" \
        --exclude="$shop/app/tmp" \
        --exclude="$shop/app/log" \
        --exclude="$shop/app/.git" \
        "$shop" 2>/dev/null; then
    if verify_gz "$app" 10000 "$shop/app"; then
      log "  $shop app      $(human "$(size_of "$app")")"
      total=$(( total + $(size_of "$app") ))
    else ok=0; fi
  else
    rm -f "$app"; warn "$shop/app: tar failed"; ok=0
  fi

  chmod -R go-rwx "$BACKUP_ROOT/$shop"

  [ -n "$SHOPS_JSON" ] && SHOPS_JSON="$SHOPS_JSON,"
  SHOPS_JSON="$SHOPS_JSON{\"shop\":\"$shop\",\"ok\":$([ $ok = 1 ] && echo true || echo false),\"bytes\":$total,\"path\":\"$out\"}"

  if [ $ok = 1 ]; then
    log "$shop  ok  $(human "$total")"
  else
    FAILURES+=("$shop")
    warn "$shop incomplete, keeping what succeeded"
  fi

  # ── retention, per shop, newest always kept ───────────────────────────────
  local newest
  newest=$(ls -1dt "$BACKUP_ROOT/$shop"/*/ 2>/dev/null | head -1)
  for d in $(find "$BACKUP_ROOT/$shop" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" 2>/dev/null); do
    [ "$d/" = "$newest" ] && continue
    rm -rf "$d" && log "  swept $(basename "$d")"
  done
}

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

if [ $# -ge 1 ]; then
  backup_shop "$1"
else
  found=0
  for d in /srv/*/; do
    [ -f "$d/docker-compose.yml" ] || continue
    found=1
    backup_shop "$(basename "$d")"
  done
  if [ "$found" != 1 ]; then
    receipt "failed" "no shops found under /srv"
    warn "no shops found under /srv"; exit 1
  fi
fi

if [ ${#FAILURES[@]} -gt 0 ]; then
  receipt "failed" "incomplete: ${FAILURES[*]}"
  warn "finished with failures: ${FAILURES[*]}"
  exit 1
fi

receipt "ok" "all shops backed up"
log "done, $(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1) on disk"
