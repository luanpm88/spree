#!/usr/bin/env bash
#
# Send the commercial server's backups to Backblaze, after the backup has run.
#
#   spree-offsite-b2.sh <bucket>
#
# Installed at /root/spree-offsite-b2.sh, called by cron at 02:45 UTC. The
# backup itself runs at 02:15 and takes under a minute.
#
# ── why this exists ──────────────────────────────────────────────────────────
#
# Measured 10 September. /usr/local/bin/spree-backup had been running nightly
# and correctly for weeks, writing about 1.1 GB into /var/backups/spree, which is
# the same disk as the databases it protects. rclone was not installed on this
# box at all, and the Backblaze bucket the client created for it on 26 August
# held ZERO objects fifteen days later.
#
# So losing this disk would have lost the shop and its only backup together.
#
# ── why it is a separate script and not a change to the backup ──────────────
#
# /usr/local/bin/spree-backup works. It has its own refusals, its own receipt,
# and script/backups reads that receipt from outside the box. Editing a working
# backup to bolt an upload onto it risks the part that already protects him for
# the sake of the part that does not exist yet. This runs after it and reads what
# it produced, so the worst this script can do is fail to upload.
#
# ── the three things it does not do, each for a reason ──────────────────────
#
# It never uses `rclone sync`. Sync would faithfully delete on the far side
# anything missing here, which turns the local job's own sweep into a deletion of
# the offsite history. `copy` only ever adds. This is the same decision the
# estate script records and for the same reason.
#
# It does not trust rclone's exit code. Files are counted on both sides, because
# "the upload command exited 0" and "the files are there" are different claims
# and this project has been caught believing the first one.
#
# It does not report success on an empty list. If no shop directory is found, it
# refuses. That guard is here because the estate's nightly job did NOT have it:
# it looped straight over a command substitution, so an empty result meant the
# loop body never ran and the job logged "done, 0 failure(s)" having backed up
# nothing at all.
set -uo pipefail

BUCKET="${1:?usage: spree-offsite-b2.sh <bucket>}"
SRC=/var/backups/spree
LOG=/var/log/spree-offsite-b2.log
KEEP_DAYS=30

exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) starting"

fail=0

if [ ! -d "$SRC" ]; then
  echo "  FAIL $SRC does not exist. Refusing to report success."
  echo "=== $(date -u +%FT%TZ) done, 1 failure(s)"
  exit 1
fi

# The shop list, and a refusal if it is empty. See the note above.
SHOPS=$(find "$SRC" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort)
if [ -z "$SHOPS" ]; then
  echo "  FAIL no shop directories under $SRC. Refusing to report success."
  echo "=== $(date -u +%FT%TZ) done, 1 failure(s)"
  exit 1
fi

for shop in $SHOPS; do
  local_n=$(find "$SRC/$shop" -type f 2>/dev/null | wc -l)
  if [ "$local_n" -eq 0 ]; then
    echo "  SKIP $shop has no files on disk"
    continue
  fi
  if rclone copy "$SRC/$shop" "b2s3:$BUCKET/$shop/" >/dev/null 2>&1; then
    remote_n=$(rclone size "b2s3:$BUCKET/$shop/" --json 2>/dev/null \
               | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
    if [ "${remote_n:-0}" -lt "$local_n" ]; then
      echo "  FAIL $shop  $local_n on disk, only ${remote_n:-0} in the bucket"
      fail=$((fail+1))
    else
      echo "  ok   $shop  $local_n file(s) on disk, ${remote_n} in the bucket"
    fi
  else
    echo "  FAIL $shop upload"
    fail=$((fail+1))
  fi
done

# Retention on the far side, longer than the local sweep on purpose: the offsite
# copy is the one that has to survive somebody deleting the wrong thing here.
if rclone delete --min-age "${KEEP_DAYS}d" "b2s3:$BUCKET/" >/dev/null 2>&1; then
  echo "  swept anything older than ${KEEP_DAYS} days"
else
  echo "  ! sweep of objects older than ${KEEP_DAYS} days did not complete"
fi

echo "=== $(date -u +%FT%TZ) done, ${fail} failure(s)"
[ "$fail" -eq 0 ] || exit 1
