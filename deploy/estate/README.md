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
