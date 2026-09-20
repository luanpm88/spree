#!/usr/bin/env bash
# Nightly dump of every shop to Backblaze. Written by script/backup_b2 in the
# Spree checkout; keep the two in step.
#
# It refuses to upload a dump that does not read back, because a zero byte file
# uploaded on schedule is worse than no schedule: it looks like a backup.
set -uo pipefail
PG=estate-postgres
BUCKET="$1"
STAMP=$(date -u +%Y%m%d-%H%M%S)
LOG=/var/log/spree-backup-b2.log
exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) starting"
fail=0

# The shop list, and a refusal if it is empty.
#
# This looped straight over the command substitution. If that returns nothing,
# because Postgres is not up yet or a container was renamed, the loop body never
# runs, fail stays 0, and this job writes "done, 0 failure(s)" having backed up
# nothing at all. The hand-run script/backup_b2 has always refused that case; the
# unattended one, which is the one nobody is watching at 03:15, did not.
DBS=$(docker exec $PG psql -U postgres -lqt | cut -d'|' -f1 | sed 's/^ *//;s/ *$//' | grep -E '_shop$')
if [ -z "$DBS" ]; then
  echo "  FAIL no databases matched _shop. Refusing to report success."
  echo "=== $(date -u +%FT%TZ) done, 1 failure(s)"
  exit 1
fi

for db in $DBS; do
  f=/tmp/${db}-${STAMP}.dump
  if ! docker exec $PG pg_dump -U postgres -Fc "$db" > "$f" 2>/tmp/pgerr; then
    echo "  FAIL $db pg_dump: $(head -1 /tmp/pgerr)"; fail=$((fail+1)); rm -f "$f"; continue
  fi
  n=$(docker exec -i $PG pg_restore -l < "$f" 2>/dev/null | grep -c 'TABLE DATA') || n=0
  if [ "$n" -eq 0 ]; then
    echo "  FAIL $db dump does not read back, not uploading"; fail=$((fail+1)); rm -f "$f"; continue
  fi
  if rclone copy "$f" "b2s3:$BUCKET/postgres/$db/" >/dev/null 2>&1; then
    echo "  ok   $db  $n tables  $(stat -c %s "$f") bytes"
  else
    echo "  FAIL $db upload"; fail=$((fail+1))
  fi
  rm -f "$f"
done
# 30 days of history, then let go. Seven shops at ~2 MB is under a gigabyte a year.
rclone delete --min-age 30d "b2s3:$BUCKET/postgres/" >/dev/null 2>&1

# ── the product images, which the databases above do not protect ─────────────
#
# He asked on 29 Aug: "Are you backing up all the images and shop files?" The
# answer then was no. Only the databases went up, and a database restored without
# its images is a shop where every product renders a grey box. Those files came
# off his old server, so the only other copy was wherever that server still keeps
# them.
#
# copy, not sync, and not a dated archive.
#
#   copy    never deletes on the far side. A file lost here by accident stays in
#           the bucket. sync would faithfully delete it there too, which is the one
#           thing a backup must never do.
#   not tar Active Storage names every blob after its content, so a file never
#           changes once written. A dated archive would send the same 877 MB every
#           night and thirty of them would be 26 GB of identical bytes. This sends
#           each file once and then only what is new.
#
# The retention line above is scoped to postgres/ on purpose, so it never reaches
# these.
echo "--- files"
for c in $(docker ps --format '{{.Names}}' | grep -E '_web$' | sort); do
  shop="${c%_web}"
  vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/rails/storage"}}{{.Source}}{{end}}{{end}}' "$c" 2>/dev/null)
  if [ -z "$vol" ] || [ ! -d "$vol" ]; then
    echo "  SKIP $shop has no storage directory on disk"; fail=$((fail+1)); continue
  fi
  local_n=$(find "$vol" -type f 2>/dev/null | wc -l)
  if rclone copy "$vol" "b2s3:$BUCKET/storage/$shop/" >/dev/null 2>&1; then
    remote_n=$(rclone size "b2s3:$BUCKET/storage/$shop/" --json 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
    # Counted on both sides, because "the upload command exited 0" and "the files
    # are there" are different claims and this project has been caught believing
    # the first one.
    if [ "${remote_n:-0}" -lt "$local_n" ]; then
      echo "  FAIL $shop  $local_n on disk, only ${remote_n:-0} in the bucket"; fail=$((fail+1))
    else
      echo "  ok   $shop  $local_n file(s) on disk, ${remote_n} in the bucket"
    fi
  else
    echo "  FAIL $shop upload"; fail=$((fail+1))
  fi
done

echo "=== $(date -u +%FT%TZ) done, $fail failure(s)"
