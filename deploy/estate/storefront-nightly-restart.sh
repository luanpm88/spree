#!/bin/bash
# Restart one shop's storefront container at that shop's quiet hour, so its Node
# heap is emptied before it reaches the ceiling (docs/DISCOVERIES.md 93: the heap
# fills in two to four days, pages crawl for minutes, then the process dies at
# whatever hour that happens to be).
#
# Called from root's crontab, one line per shop:
#   /root/storefront-nightly-restart.sh <shop> >/dev/null 2>>/var/log/storefront-nightly-restart.log
# and this file is a byte identical copy of deploy/estate/storefront-nightly-restart.sh.
#
#   storefront-nightly-restart.sh <shop>            restart <shop>_storefront if it is due
#   storefront-nightly-restart.sh <shop> --dry-run  every check, no restart, no date gate
#
# Nothing restarts unless /root/storefront-nightly-restart.enabled exists and the
# date written in it (YYYY-MM-DD, UTC) has arrived. Deleting that file stops every
# restart without touching cron. It never starts a stopped container (someone may
# have stopped it on purpose), and it leaves alone one that started less than
# MIN_UP_HOURS ago, because a deploy has just done the job.
set -u
LOG=/var/log/storefront-nightly-restart.log
FLAG=/root/storefront-nightly-restart.enabled
MIN_UP_HOURS=12
READY_TIMEOUT=90

shop=${1:-}
mode=${2:-}
log() { printf '%s %s %s\n' "$(date -u +%FT%TZ)" "${shop:-?}" "$*" | tee -a "$LOG"; }

[ -n "$shop" ] || { echo "usage: $0 <shop> [--dry-run]" >&2; exit 2; }
c="${shop}_storefront"

if [ "$mode" != "--dry-run" ]; then
  if [ ! -f "$FLAG" ]; then log "disabled: $FLAG is missing, nothing restarted"; exit 0; fi
  start=$(tr -d '[:space:]' < "$FLAG")
  if ! [[ "$start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then log "FAIL $FLAG holds '$start', not a YYYY-MM-DD date"; exit 1; fi
  if [[ "$(date -u +%F)" < "$start" ]]; then log "not yet: restarts begin $start, nothing restarted"; exit 0; fi
fi

running=$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)
if [ "$running" != "true" ]; then log "SKIP $c is not running (${running:-no such container}); this script never starts one"; exit 0; fi

started=$(docker inspect -f '{{.State.StartedAt}}' "$c")
up_s=$(( $(date -u +%s) - $(date -u -d "$started" +%s) ))
up_h=$(awk -v s="$up_s" 'BEGIN { printf "%.1f", s / 3600 }')
if [ "$up_s" -lt $(( MIN_UP_HOURS * 3600 )) ]; then log "SKIP up only ${up_h}h, under ${MIN_UP_HOURS}h: a deploy or a crash restarted it already"; exit 0; fi

port=$(docker port "$c" 2>/dev/null | head -1 | sed -E 's/.*:([0-9]+)$/\1/')
if ! [[ "$port" =~ ^[0-9]+$ ]]; then log "FAIL no published port for $c"; exit 1; fi
mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$c" 2>/dev/null)

if [ "$mode" = "--dry-run" ]; then log "DRY RUN would restart: up ${up_h}h, memory ${mem}, answers on port ${port}"; exit 0; fi

t0=$(date +%s)
if ! docker restart -t 10 "$c" >/dev/null 2>&1; then log "FAIL docker restart $c returned an error"; exit 1; fi
code=000
deadline=$(( t0 + READY_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${port}/" || true)
  [ "$code" != "000" ] && break
  sleep 1
done
took=$(( $(date +%s) - t0 ))
if [ "$code" = "000" ]; then log "FAIL restarted but not answering on port ${port} after ${took}s (was up ${up_h}h, memory ${mem})"; exit 1; fi
log "restarted: was up ${up_h}h with memory ${mem}, answering again after ${took}s (HTTP ${code})"
