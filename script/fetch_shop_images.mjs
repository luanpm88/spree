// Pull a shop's product images off the shop that is still running.
//
//   script/fetch_shop_images.mjs ca                 fetch, verify, stage
//   script/fetch_shop_images.mjs ca --apply         also re-point the blobs to local disk
//   script/fetch_shop_images.mjs ca --limit 20      stop early, for a first look
//
// ── why this exists ──────────────────────────────────────────────────────────
//
// The dumps carry the database and nothing else. Every image lives in a MinIO
// bucket on the old server, and that box refuses ssh on every port from here
// and does not expose MinIO to the internet either, so the files cannot be
// copied the obvious way.
//
// They can still be read, because the shop they belong to is serving them to
// customers right now. The storefront API hands back an `original_url` for
// every product image, which is a signed proxy URL to the ORIGINAL blob, not a
// thumbnail. That is a documented, public endpoint of a shop the client owns.
//
// ── why the id mapping is safe ───────────────────────────────────────────────
//
// The v2 API's image `id` is the Spree::Asset id, checked against the database:
// API ids 5 and 6 are assets 5 and 6, filenames and all. So each downloaded
// file maps to exactly one blob row. Matching on filename instead would have
// been a guess, and this shop has several images that differ only by which
// product they hang off.
//
// Every download is verified against the blob's stored MD5 before it is
// written. A file that arrives truncated or as an error page therefore fails
// here rather than becoming a broken image on the new shop.
//
// ── what --apply changes ─────────────────────────────────────────────────────
//
// Only the working copy, never the pristine one, and never anything on the
// client's servers. Two changes:
//
//   service_name  minio -> local, because the new install has no minio and
//                 Rails raises on an undefined service rather than degrading.
//   variants      the 2353 ActiveStorage::VariantRecord rows are deleted. They
//                 are derived files, not client data: Rails regenerates each
//                 one the first time it is asked for. Keeping them would leave
//                 rows pointing at files that were never copied.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, openSync } from 'node:fs'
import path from 'node:path'

// The shop list lives in .estate, gitignored, because it names the client's shops
// and their live domains and this repository is public. The commit hook refused
// this file when the table was inline here, and it was right to.
// .estate.env carries the ssh and minio details for both servers. Read here so
// the script works the same whether or not the caller sourced it.
if (existsSync('.estate.env')) {
  for (const line of readFileSync('.estate.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace('$HOME', process.env.HOME)
    }
  }
}

const ESTATE = process.env.ESTATE_FILE || '.estate'
if (!existsSync(ESTATE)) {
  console.error(`error  no ${ESTATE}. Copy .estate.example and fill it in.`)
  process.exit(1)
}
const SHOPS = Object.fromEntries(
  readFileSync(ESTATE, 'utf8').split('\n')
    .filter((l) => l.includes('|') && !l.trimStart().startsWith('#'))
    .map((l) => l.split('|'))
    .filter((f) => f[7] && f[7].trim() !== '-')
    .map((f) => [f[0].trim(), { db: f[2].trim(), live: f[7].trim() }])
)

const args = process.argv.slice(2)
const shop = args.find((a) => !a.startsWith('-'))
const APPLY = args.includes('--apply')
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || Infinity
const die = (m) => { console.error(`error  ${m}`); process.exit(1) }

const S = SHOPS[shop] || die(`unknown shop '${shop}'. Known: ${Object.keys(SHOPS).join(', ')}`)
const OUT = path.join('tmp/client/images', shop)

const psql = (sql, db = S.db) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres',
    '-d', db, '-At', '-F', '\t', '-c', sql], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .trim().split('\n').filter(Boolean).map((l) => l.split('\t'))

// ── what the database expects ────────────────────────────────────────────────
const blobs = psql(`
  SELECT a.id, ab.id, ab.key, ab.filename, ab.byte_size, ab.checksum, ab.service_name
  FROM spree_assets a
  JOIN active_storage_attachments aa ON aa.record_id = a.id AND aa.record_type = 'Spree::Asset'
  JOIN active_storage_blobs ab ON ab.id = aa.blob_id
  ORDER BY a.id
`).map(([assetId, blobId, key, filename, byteSize, checksum, service]) =>
  ({ assetId, blobId, key, filename, byteSize: Number(byteSize), checksum, service }))

console.log(`  ${blobs.length} product images in ${S.db}`)

// ── pass zero: the old server, which is where these files actually live ──────
//
// Everything below this was written because the old box refused ssh on every
// port that was tried. The client supplied the right one (it was not the port
// the tracker recorded), so the bucket is reachable and this is now the first
// thing to try rather than the last resort.
//
// It is also the only complete source. The storefront API only lists products
// it publishes, so images belonging to draft and archived products — 65 of them
// on Canada — cannot be reached any other way.
//
// Read only. mc runs inside the client's own minio container with its
// credentials passed through the environment, so nothing is written to his
// configuration, and the staging directory it uses is the container's /tmp,
// removed on the way out.
const OLD = {
  key: process.env.OLD_SSH_KEY, host: process.env.OLD_SSH_HOST, port: process.env.OLD_SSH_PORT,
  container: process.env.MINIO_CONTAINER, user: process.env.MINIO_USER, pass: process.env.MINIO_PASS,
  port_api: process.env.MINIO_PORT || '9003'
}
const staged = (b) => existsSync(path.join(OUT, b.key.slice(0, 2), b.key.slice(2, 4), b.key))

if (OLD.host && OLD.user) {
  const bucket = process.env.MINIO_BUCKET || new URL(S.live).host
  // EVERY blob, not just the product ones. `blobs` above is the Spree::Asset
  // query, and asking minio only for those left the store's mailer logo, the
  // favicon and an admin avatar behind — attachments on Spree::Store and
  // Spree::AdminUser, which are not assets. Same mistake as the apply step made
  // earlier in this file, made again in a second place.
  // Skip blobs that only back a variant. Those are DERIVED thumbnails, they get
  // deleted a few lines further down and Rails regenerates them on demand, so
  // pulling them would mean asking the client's live server for 2,600 files per
  // shop that are thrown away on arrival. Originals only.
  const allWanted = psql(`
    SELECT DISTINCT ab.id, ab.key, ab.filename, ab.byte_size, ab.checksum
    FROM active_storage_blobs ab
    JOIN active_storage_attachments aa ON aa.blob_id = ab.id
    WHERE aa.record_type <> 'ActiveStorage::VariantRecord'
  `).map(([blobId, key, filename, byteSize, checksum]) =>
    ({ blobId, key, filename, byteSize: Number(byteSize), checksum }))
  const want = allWanted.filter((b) => !staged(b))
  if (!want.length) {
    console.log('  old server: nothing missing')
  } else {
    console.log(`  old server: asking minio for ${want.length} file(s) from ${bucket}`)
    const keys = [...new Set(want.map((b) => b.key))]
    const tar = path.join(OUT, '_minio.tar')
    mkdirSync(OUT, { recursive: true })
    const sshArgs = ['-i', OLD.key.replace(/^~|^\$HOME/, process.env.HOME), '-p', OLD.port,
      '-o', 'BatchMode=yes', OLD.host]

    try {
      // The key list goes over as a FILE, and the loop reads it inside the
      // container. The first attempt built one shell line holding 65 `mc cat`
      // commands; it passed through ssh's login shell, then docker exec, then
      // sh -c, and the quoting did not survive three layers. It reported zero
      // recovered with no error, which is the worst way to fail.
      execFileSync('ssh', [...sshArgs, 'cat > /tmp/_keys.txt'],
        { input: keys.join('\n') + '\n', stdio: ['pipe', 'ignore', 'ignore'] })

      // The tar happens on the HOST, not inside the container. The minio image
      // is minimal and ships no tar, so doing it there exited 127 with empty
      // stderr, which surfaced only as "Command failed" and looked like a
      // permissions or quoting problem for a while.
      const pull = `docker cp /tmp/_keys.txt ${OLD.container}:/tmp/_keys.txt >/dev/null && ` +
        `docker exec -e MC_HOST_o="http://${OLD.user}:${OLD.pass}@localhost:${OLD.port_api}" ${OLD.container} ` +
        `sh -c 'rm -rf /tmp/_pull; mkdir -p /tmp/_pull; cd /tmp/_pull; ` +
        `while read k; do mc cat o/${bucket}/$k > $k 2>/dev/null || rm -f $k; done < /tmp/_keys.txt' && ` +
        `rm -rf /tmp/_pull && docker cp ${OLD.container}:/tmp/_pull /tmp/_pull >/dev/null && ` +
        `tar -cf - -C /tmp/_pull .`
      execFileSync('ssh', [...sshArgs, pull],
        { stdio: ['ignore', openSync(tar, 'w'), 'pipe'], maxBuffer: 512 << 20 })
      execFileSync('tar', ['-xf', tar, '-C', OUT])

      let ok = 0, wrong = 0
      for (const b of want) {
        const flat = path.join(OUT, b.key)
        if (!existsSync(flat)) continue
        const buf = readFileSync(flat)
        // Same check as every other route in this file: the bytes must be the
        // bytes the database describes, or they do not get used.
        if (createHash('md5').update(buf).digest('base64') !== b.checksum) { wrong++; continue }
        const dest = path.join(OUT, b.key.slice(0, 2), b.key.slice(2, 4), b.key)
        mkdirSync(path.dirname(dest), { recursive: true })
        writeFileSync(dest, buf)
        ok++
      }
      for (const k of keys) { try { unlinkSync(path.join(OUT, k)) } catch {} }
      try { unlinkSync(tar) } catch {}
      // Leave the client's server as it was found.
      try {
        execFileSync('ssh', [...sshArgs,
          `rm -rf /tmp/_keys.txt /tmp/_pull; docker exec ${OLD.container} rm -rf /tmp/_pull /tmp/_keys.txt`],
          { stdio: 'ignore' })
      } catch {}

      console.log(`  old server: ${ok} recovered${wrong ? `, ${wrong} failed the checksum` : ''}`)
    } catch (e) {
      // Print what the remote actually said. Swallowing it into a one line
      // summary cost a debugging round: the message was the ssh command line,
      // not the reason.
      // Redact the credentials before printing. The first version of this
      // helpfully echoed the failing command, minio password and all, into the
      // terminal and from there into a transcript.
      const scrub = (t) => String(t).replace(/\/\/[^@\s"']+@/g, '//***:***@')
      const why = (e.stderr && e.stderr.toString().trim()) || e.message
      console.log(`  old server: could not read the bucket`)
      console.log(`    ${scrub(why).split('\n').slice(0, 6).join('\n    ')}`)
    }
  }
} else {
  console.log('  old server: no credentials in .estate.env, skipping')
}

// ── what the live shop will hand over ────────────────────────────────────────
// The API pass is a FALLBACK, from before the old server was reachable. Once
// minio has handed over everything, asking the live shop for the same files is
// pointless, and a shop that does not expose the v2 API — the wholesale one does
// not — made the whole run die at this line after minio had already succeeded.
const stillNeeded = blobs.filter((b) => !staged(b))
const urls = new Map()
for (let page = 1; stillNeeded.length; page++) {
  let r
  try {
    r = await fetch(`${S.live}/api/v2/storefront/products?include=images&per_page=50&page=${page}`)
  } catch (e) {
    console.log(`  live shop unreachable (${String(e.message).slice(0, 50)}), skipping the api pass`)
    break
  }
  if (!r.ok) {
    console.log(`  live shop has no v2 api (HTTP ${r.status}), skipping the api pass`)
    break
  }
  const j = await r.json()
  for (const inc of j.included || []) {
    if (inc.type !== 'image') continue
    const u = inc.attributes?.original_url
    if (u) urls.set(String(inc.id), u.startsWith('http') ? u : S.live + u)
  }
  if (!j.data?.length || page >= (j.meta?.total_pages || 1)) break
}
console.log(`  ${urls.size} images offered by ${new URL(S.live).host}`)

// ── fetch, verify, stage ─────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true })
let got = 0, already = 0, corrupt = 0, gone = 0
const noUrl = []

// Several assets can share one blob: this shop attaches the same photograph to
// three products, and they are one row in active_storage_blobs with one key. So
// a "missing" asset whose blob was already fetched through a sibling is not
// missing at all. Everything below counts blobs and files, not assets, and the
// final gap is computed from what is on disk.
for (const b of blobs.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
  const url = urls.get(b.assetId)
  if (!url) { noUrl.push(b); continue }

  // Active Storage's Disk service splits the key: ab/cd/abcdef...
  const dest = path.join(OUT, b.key.slice(0, 2), b.key.slice(2, 4), b.key)
  if (existsSync(dest)) { already++; continue }

  const r = await fetch(url)
  // A 404 and a wrong checksum are different problems and must not share a
  // counter. 404 means the live shop no longer holds that file, which is a fact
  // about the client's data and is reported. A checksum mismatch means the
  // bytes that arrived are not the bytes the database describes, which is
  // corruption and stops the run.
  if (!r.ok) { console.log(`  ! ${b.filename}: the live shop returned HTTP ${r.status}`); gone++; continue }
  const buf = Buffer.from(await r.arrayBuffer())

  // Verify against what the database says the bytes are. An error page, a
  // redirect to a login, or a truncated transfer all fail right here instead
  // of becoming a broken image nobody notices until the client clicks it.
  const md5 = createHash('md5').update(buf).digest('base64')
  if (md5 !== b.checksum) {
    console.log(`  ! ${b.filename}: checksum differs (${buf.length} bytes, expected ${b.byteSize})`)
    corrupt++
    continue
  }

  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  got++
  if (got % 25 === 0) console.log(`    ${got} fetched`)
}

const onDisk = (b) => existsSync(path.join(OUT, b.key.slice(0, 2), b.key.slice(2, 4), b.key))
const stillMissing = blobs.filter((b) => !onDisk(b))
const missingBlobs = new Set(stillMissing.map((b) => b.blobId))
const coveredBySibling = noUrl.filter(onDisk).length

console.log(`\n  fetched ${got}, already had ${already}`)
console.log(`  ${blobs.length - stillMissing.length} of ${blobs.length} attachments have their file`)
if (coveredBySibling) {
  console.log(`  ${coveredBySibling} had no url of their own but share a blob with one that did`)
}
if (gone) console.log(`  ${gone} the live shop no longer serves`)
if (missingBlobs.size) {
  console.log(`\n  ${missingBlobs.size} distinct image(s) still not copied, on ${stillMissing.length} attachment(s):`)
  ;[...new Map(stillMissing.map((b) => [b.blobId, b])).values()].slice(0, 12)
    .forEach((b) => console.log(`    ${b.filename}`))
  console.log('  these belong to products the storefront does not publish, so the API never lists them')
}

if (corrupt) die(`${corrupt} image(s) did not match the checksum in the database. Nothing has been applied.`)

// ── second pass: everything that is not a product image ──────────────────────
//
// The store logo, the favicon, the mailer logo, the OG image and the homepage
// artwork are not products, so the products API never mentions them. They are
// also the images that decide whether the shop LOOKS right, which is the whole
// point of a review copy: a shop with every product photograph and no logo
// reads as broken.
//
// They are all on the live pages, but as resized variants, so the bytes on the
// page do not match the original's checksum. The way through is that a
// representation URL carries the blob's signed id as its own path segment:
//
//   /rails/active_storage/representations/proxy/:signed_blob_id/:variation/:filename
//   /rails/active_storage/blobs/proxy/:signed_blob_id/:filename
//
// Both routes verify that id with the same purpose, so the id lifted out of a
// thumbnail URL addresses the original through the blob route. Public routes,
// the app's own signatures, no secret needed. Verified: favicon180.png came
// back byte for byte, checksum matching the database.
const allBlobs = psql(`
  SELECT ab.id, ab.key, ab.filename, ab.byte_size, ab.checksum
  FROM active_storage_blobs ab WHERE ab.service_name <> 'local'
`).map(([id, key, filename, byteSize, checksum]) => ({ id, key, filename, byteSize: Number(byteSize), checksum }))

if (allBlobs.length) {
  const wanted = new Map(allBlobs.map((b) => [b.checksum, b]))
  console.log(`\n  second pass: ${wanted.size} image(s) the products API cannot reach`)

  const seen = new Set()
  const pages = ['/', '/products', '/pages/about-us', '/pages/about', '/pages/contact']
  const found = new Set()

  for (const page of pages) {
    let html
    try {
      const r = await fetch(S.live + page)
      if (!r.ok) continue
      html = await r.text()
    } catch { continue }

    // Both shapes, plus whatever sits in a srcset or a style attribute.
    for (const m of html.matchAll(/\/rails\/active_storage\/(?:representations|blobs)\/proxy\/([^/"'\s]+)\/(?:[^/"'\s]+\/)?([^"'\s?)]+)/g)) {
      const [, signedId, filename] = m
      const url = `${S.live}/rails/active_storage/blobs/proxy/${signedId}/${filename}`
      if (seen.has(url)) continue
      seen.add(url)

      let buf
      try {
        const r = await fetch(url)
        if (!r.ok) continue
        buf = Buffer.from(await r.arrayBuffer())
      } catch { continue }

      // Matched by checksum, not by name. Several of these files share a
      // filename across shops and page sections, and the checksum is the only
      // thing that says which blob row this actually is.
      const md5 = createHash('md5').update(buf).digest('base64')
      const b = wanted.get(md5)
      if (!b || found.has(b.id)) continue

      const dest = path.join(OUT, b.key.slice(0, 2), b.key.slice(2, 4), b.key)
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
      found.add(b.id)
      console.log(`    recovered ${b.filename}`)
    }
  }
  console.log(`  ${found.size} of ${wanted.size} recovered by crawling ${pages.length} live pages`)
}

if (!APPLY) {
  console.log(`\n  staged in ${OUT}/`)
  console.log('  re-run with --apply to point the blobs at local disk')
  process.exit(missingBlobs.size ? 1 : 0)
}

// ── re-point the working copy ────────────────────────────────────────────────
//
// Every blob whose file is now staged, not merely the product ones. The first
// version of this built the list from the Spree::Asset query at the top, so the
// store logo was downloaded, written to disk, and then left pointing at the
// `mirror` service that this install does not define. Rails answered the logo
// request with
//
//   KeyError: Missing configuration for the mirror Active Storage service
//
// a 500 on every page, for a file that was sitting right there on disk.
const onDiskBlobs = psql(`SELECT id, key FROM active_storage_blobs`)
  .filter(([, key]) => existsSync(path.join(OUT, key.slice(0, 2), key.slice(2, 4), key)))
const fetched = new Set(onDiskBlobs.map(([id]) => id))
if (!fetched.size) die('nothing staged, so nothing to apply')

const ids = [...fetched].join(',')
psql(`UPDATE active_storage_blobs SET service_name = 'local' WHERE id IN (${ids})`)
console.log(`  ${fetched.size} blob(s) now served from local disk`)

// Derived files, not client data. Rails rebuilds each one on first request.
//
// Order matters and got this wrong once. A variant's blob is only an orphan
// once the attachment row pointing at it is gone, so sweeping orphans before
// deleting those attachments leaves every variant blob in place: 2428 rows
// still naming a storage service this install does not have, and the sweep
// reporting success. Attachments first, then the records, then the orphans.
psql(`DELETE FROM active_storage_attachments WHERE record_type = 'ActiveStorage::VariantRecord'`)
const [[variants]] = psql(`
  WITH gone AS (DELETE FROM active_storage_variant_records RETURNING id)
  SELECT count(*) FROM gone
`)
const [[orphans]] = psql(`
  WITH gone AS (
    DELETE FROM active_storage_blobs
    WHERE id NOT IN (SELECT blob_id FROM active_storage_attachments)
    RETURNING id
  ) SELECT count(*) FROM gone
`)
console.log(`  ${variants} variant record(s) dropped, Rails will regenerate them on demand`)
console.log(`  ${orphans} orphaned blob row(s) swept`)

const [[left]] = psql(`SELECT count(*) FROM active_storage_blobs WHERE service_name <> 'local'`)
console.log(left === '0'
  ? '\n  ok — every blob in this database is served from local disk'
  : `\n  ${left} blob(s) still point at a service this install does not have`)
