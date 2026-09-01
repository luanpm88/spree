# Keeping seven shops alive

One command answers "is the estate healthy":

```bash
script/health              # every shop, including a browser and an image sweep
script/health ca           # one shop
script/health --quick      # no browser, fast enough to run every few minutes
script/health --explain    # what each check is for, and why it exists
```

It exits non-zero on a failure and prints the command to run for each one. Run it
after touching anything, and on any morning somebody wants to know the shops are
fine.

---

## 1. What it checks, and the fault behind each check

Nothing here is theoretical. Every line is a fault that reached the client or came
within minutes of doing so.

| Check | The fault it exists for |
|---|---|
| container on the current image | `ship` builds and stops. Five shops ran code from before a fix while the fix sat in the image. A remediation task run inside a stale container can **undo** the fix it was meant to apply |
| the shop answers with its own title | A shop serving another shop's build looks perfectly healthy until you read the name |
| content pages answer | `/contact`, a policy page and a category page render through the layout, which fetches categories. They fail **together and silently**: the home page keeps serving from prerender. Four live shops sat at 500 for an hour behind a browser walk scoring 31 of 31 |
| the API host resolves | After a cutover the old hostname stops existing, and a build made before the cutover still names it. One shop's login said "fetch failed" while its catalogue worked, because the two paths used different hosts |
| product photographs | An image count of "21 of 21" was true and meaningless on a page with no `<img>` at all. This looks at what a customer sees, and writes a picture |
| image URLs from the SERVER's path | The image optimiser runs on the box, so it reaches a different Cloudflare edge than a laptop. An error cached at that edge blanks images for every visitor while a laptop watches them load. 10 of 104 URLs on one shop |
| products with no image | The upgrade blanks `primary_media_id`, and one bad remedy blanked it again |
| orphan variant records | Variant records come across in the dump; the files behind them never do. A share of image sizes 404s while the page still looks right |
| shipping category with no method | Three bottles sat in a category no method serves. A customer buying one reaches checkout and is offered nothing |
| rule-based category holding products | The 5.6 Store API serves no automatic taxon. The category page is empty and the link to it answers 200 |
| the on-sale collection | Same cause, and a reload puts it back every time |
| mail_from on a `send.` subdomain | His roots are on DMARC `p=reject`. The wrong From does not go to junk, it **bounces** |
| SMTP is not the local catcher | A shop still pointed at mailpit sends nothing to anyone and says nothing |
| a gateway is active | `load` switches payments off on purpose. Switching them back on is a separate step and has been forgotten |
| no noindex header | Correct on a review copy, wrong the moment the shop is live |
| the order prefix | Customers quote these. One shop's was changed without anyone noticing |
| writes are allowed | A 403 means his freeze rule is still on and nothing can be ordered |

---

## 2. How to read a red line

**Suspect the check before the shop.** On 28 August, four red lines out of seven
were the measurement being wrong, not the estate:

- `sed 's#^https\?://##'` does nothing on macOS, so a walk was pointed at
  `https://https//host` and the navigation error printed as "the browser walk
  failed" on a healthy shop
- `waitUntil: "networkidle"` never arrives on a page carrying a chat widget, so a
  scroll raced hydration and the crash printed as "photographs did not render"
- an image count conflated **broken** with **still loading** and failed a shop
  where the browser logged zero 4xx
- a new selling check read `/cart`, which on this storefront is a drawer rather
  than a page, and declared a working shop unable to sell

Every message in `script/health` therefore names the command that reproduces it.
Run that first. If it disagrees with the check, the check is wrong.

**And the opposite trap.** The same day, one green reading was wrong in the other
direction: `grep -rl` found the dead hostname only in files under
`.next/server/app` and that was read as "prerendered, therefore inert". Those are
exactly the files the running server hands out, and four shops were serving 500s
while that conclusion was being written down.

The rule that survives both: **ask the question the customer asks.** A `curl` to
`/contact` settles in one second what two greps argued about for twenty minutes.

---

## 3. The routine jobs

### After changing anything in `app/`, `lib/` or `config/`

```bash
script/check_all          # every static gate
script/shop_host ship     # build the image on the server
script/shop_host refresh   # put every container onto it, and prove they are on it
script/health --quick
```

`ship` alone changes nothing that is running. `refresh` is what makes it live.

### After changing anything in `storefront/`

```bash
script/shop_host storefront <shop> --live
script/health <shop>
```

`--live` matters: without it the build is made against the pre-cutover hostname,
which no longer resolves, and the shop's content pages all return 500.

### After loading a database

A load undoes every remediation. In order, and this is what
`script/cutover_pipeline` does for you:

```bash
docker exec <shop>_web bin/rails backfill:all        # store_id, counters, thumbnails, orphan_variants, channel
docker exec <shop>_web bin/rails on_sale:top_up
docker exec <shop>_web bin/rails shipping:category_report
script/shop_host cutover <shop> --go
script/shop_host restore_payments <shop>
script/shop_host storefront <shop> --live
script/health <shop>
```

### Moving a shop, start to finish

```bash
script/cutover_pipeline <shop>          # rehearsal, changes nothing
script/cutover_pipeline <shop> --go     # the move
script/cutover_pipeline <shop> --verify # the browser part, after he lifts his freeze
```

---

## 4. Backups

Every destructive step takes one first, and every one of them has been opened to
prove it reads back:

| When | Where |
|---|---|
| before a cutover | `/root/<shop>-precutover-<stamp>.sql.gz` |
| before replacing a database | `/root/<shop>-before-*.sql.gz` |
| before an env change | `/srv/<dir>/.env.before-<what>-<stamp>` |
| fresh copy pulled from his server | `tmp/dumps/` here, and `/root/` there |

```bash
script/pull_live_dump <shop> --dry-run   # say what it would do
script/pull_live_dump <shop>             # read-only on his server
```

A dump that has not been opened is not a backup. `pull_live_dump` runs `gzip -t`
on both machines and compares checksums, because six zero-byte dumps shipped on
this project once.

---

## 5. What only the client can do

- **Purge his Cloudflare cache** when `check_image_origin` fails. The origin is
  fine; an edge is holding an error it cached before the fix
- **Lift his write freeze** so a shop can be clicked through. While it is on,
  every non-GET answers 403 and no order can be placed
- **Point a DNS record.** Always create the vhost on our side **first**: a
  certificate for a name cannot be issued until the name already points here, so
  doing it the other way round leaves minutes with nothing answering

---

## 6. Where the detail lives

| | |
|---|---|
| `docs/DISCOVERIES.md` | Every non-obvious finding, with the measurement that proved it. **Read section 8 to 12 before debugging anything here** |
| `docs/CUTOVER.md` | The gates that must hold on changeover day |
| `docs/PLAN.md` | Where the engagement is |
| `script/health --explain` | The same list as section 1, from the tool itself |

---

## 7. What ten passes of the health check found

Running it once says the estate is fine right now. Running it ten times says
whether the check itself can be trusted, which is a different and more useful
answer. Nine of the ten were clean. The tenth found this:

```
FAIL  content pages do not answer: /c/collections/on-sale=200000
```

`200000` is not a status code. The check was `curl -w '%{http_code}' || echo 000`,
and when curl printed a code for one hop of a redirect chain and then dropped, the
fallback was **appended** to what it had already written. One network blink, one
red line about a healthy shop.

Reading the script afterwards found three more of the same family, none of which
any single run would have shown:

| | |
|---|---|
| a closed shop counted as healthy | an anonymous image count sees a login form, reports "0 photographs" and prints **ok**. A shop passed on the strength of a page with nothing on it |
| ssh dropping | every shop reports "container is not running": seven red lines about a healthy estate |
| the rails runner returning nothing | mail, SMTP, gateways and the order prefix were **skipped in silence**, so a shop whose Rails would not boot scored a clean sheet by not being asked |

The last one is the worst, and it is the rule worth keeping:

> **A check that could not run must be louder than a check that failed.**
> A failure is visible. A check that quietly did not happen looks exactly like a
> pass.

The single warning that survives all ten passes is real and is his: one spare part
on one shop has no photograph, and no image row either. He never took one.
