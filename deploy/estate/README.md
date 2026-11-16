# The estate server's own scripts

Copies of things that run **on the estate box** and have no other source.

## Why they are here

`spree-backup-b2.sh` is the nightly backup. It lives at `/root/spree-backup-b2.sh`
on the estate server, is called by cron at 03:15 UTC as
`/root/spree-backup-b2.sh spree1`, and until 10 September it existed **only**
there.

That is worth stating plainly: the script that protects seven shops was itself
the one thing on that box with no copy anywhere. It is not in the nightly backup
either, because that backup covers databases and product images, not `/root`. So
losing the box would have lost the shops' protection along with the shops, and
whoever rebuilt it would have been working from memory.

## Keeping it in step

The copy here is **byte identical** to the server's, on purpose, so it can be put
straight back with `scp` and no editing. Nothing generates it: it was written by
hand alongside `script/backup_b2`, and the header comment claiming otherwise is
aspirational. If you change one, change the other in the same sitting.

To check they still match:

```bash
ssh <estate> 'cat /root/spree-backup-b2.sh' | diff - deploy/estate/spree-backup-b2.sh
```

## What it does, briefly

Dumps every database matching `_shop` that Postgres reports, refuses to upload a
dump that does not read back, copies each running shop's `/rails/storage` volume,
counts files on both sides rather than trusting rclone's exit code, and deletes
dumps older than 30 days — scoped to `postgres/` so it can never reach the
images.

It carries no credentials. The bucket name arrives as `$1` from the cron line and
the B2 key lives in the server's rclone config.

## The guard added on 10 September

The shop list was read straight into a `for` loop. An empty result — Postgres not
up, a container renamed — meant the loop body never ran, the failure counter
stayed at zero, and the job logged `done, 0 failure(s)` having backed up nothing.
It now refuses and exits non-zero instead. Proved by pointing a copy at a
container that does not exist:

```
  FAIL no databases matched _shop. Refusing to report success.
=== done, 1 failure(s)
```

## storefront-nightly-restart.sh

Restarts one shop's storefront container at that shop's quietest hour, so its
Node heap is emptied before it reaches the 259 MB ceiling (`docs/DISCOVERIES.md`
93). It lives at `/root/storefront-nightly-restart.sh`, byte identical to this
copy, and root's crontab calls it once a day per retail shop, at minute 30 of a
quiet hour picked from 15 days of nginx logs (measured 16 Nov 2026): the hour
with the fewest browser requests, or for the two smallest shops, which are near
zero at many hours, a near-empty hour in their local small hours. The times are in the crontab rather than here, because they name the
shops. The wholesale storefront is left out: it sits behind a login and has never
reached the ceiling.

It does nothing unless `/root/storefront-nightly-restart.enabled` exists and the
date written in it (UTC) has arrived, so deleting that file is the off switch.
It never starts a stopped container, and it skips one that started less than 12
hours ago, because a deploy has already emptied that heap. Each run appends one
line to `/var/log/storefront-nightly-restart.log`: uptime and memory before, and
how many seconds the storefront took to answer again.

Proved on install without restarting anything: a missing flag, a date not yet
reached and a container that does not exist each end the run before any docker
command, and `--dry-run` on the six shops said "would restart" for the three up
30 to 75 hours and skipped the three rebuilt that morning.

To check the copy still matches:

```bash
ssh <estate> 'cat /root/storefront-nightly-restart.sh' | diff - deploy/estate/storefront-nightly-restart.sh
```
