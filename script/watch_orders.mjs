#!/usr/bin/env node
//
// A shop that keeps taking carts and stops finishing them.
//
//   node script/watch_orders.mjs              # how every shop looks right now
//   node script/watch_orders.mjs --backtest   # replay the last 45 days
//   node script/watch_orders.mjs --json       # for whatever sends the message
//
// ── the fault this exists for ───────────────────────────────────────────────
//
// Between 15 and 21 Sep the shops took no orders for 5 days and nothing said so.
// The client noticed, not us, and he noticed because his own sales stopped.
//
// Every gate in this project was green throughout. check_order_completes drove a
// real browser to the payment step and Stripe answered, on every shop, on the
// 18th, in the middle of the gap. That check is correct and it cannot catch this
// class of fault, because pressing the button worked the whole time. Something
// stopped real people finishing, and no probe that drives itself will ever see
// that.
//
// The signal that WOULD have shown it is in the shop's own two numbers:
//
//   nz  13 Sep  2 carts  1 order
//       14 Sep  3 carts  2 orders
//       15 Sep  2 carts  1 order
//       16 Sep  1 cart   0 orders
//       18 Sep  3 carts  0 orders
//       20 Sep  1 cart   0 orders
//       21 Sep  3 carts  1 order
//
// Carts kept arriving and orders stopped. That is the thing to watch.
//
// ── how it decides, and why not a fixed threshold ───────────────────────────
//
// A number like "alert after 24 hours with no order" is wrong for this estate in
// both directions: nz finishes 1 to 4 a day and a quiet day means nothing, while
// ca can go a fortnight and that is simply how busy it is. So each shop is
// measured against ITSELF: the gaps between its own completed orders over the
// previous 45 days, and it is called out when the current gap runs past twice its
// own median AND carts are still being started.
//
// Both halves matter. Past the gap on its own fires every time a shop has a quiet
// weekend. Carts on their own say nothing, because carts are created by bots and
// by anyone who opens the shop. Together they say: people are still shopping here
// and none of them can finish, which is the sentence that was true for 5 days and
// that nobody had.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const BACKTEST = args.includes("--backtest");
const AS_JSON = args.includes("--json");
const DAYS = 45;

// Probes create carts and drive them to payment. Counting our own traffic as his
// customers is how this project has already reached three wrong conclusions.
//
// Excluding by email is not enough on its own. A probe types the email at the
// ADDRESS step, so any probe run that stopped earlier leaves a cart with no
// email on it, indistinguishable from a real visitor's. On 20 Sep three such
// carts sat between probe orders timed 11:43 and 11:57, and counting them made
// one shop look like it had 18 people shopping when it had about 4.
//
// So a cart is also ours when a probe order exists on the same shop within this
// many minutes of it. Probes run in bursts; real customers do not arrive in
// bursts around our bursts.
const PROBE_EMAIL = "probe@example.test";
const PROBE_WINDOW_MIN = 20;

// ── reach the estate the same way every other script here does ──────────────
const env = {};
for (const line of readFileSync(".estate.env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const key = (env.SSH_KEY || "").replace(/^~|\$HOME|\$\{HOME\}/, homedir());
const ssh = (cmd) =>
  execFileSync(
    "ssh",
    ["-n", "-i", key, "-p", env.SSH_PORT || "22", "-o", "BatchMode=yes",
     "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=15", env.SSH_HOST, cmd],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

if (!existsSync(".estate")) {
  console.error("no .estate on this machine");
  process.exit(2);
}
const shops = readFileSync(".estate", "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("LIVE_DOMAINS="))
  .map((l) => l.split("|").map((s) => s.trim()))
  .map(([shop]) => shop)
  .filter(Boolean);

// One psql call per shop, on one line: a newline inside -c survives as a literal
// \n and psql answers "invalid command \n".
const sql = (db, q) =>
  ssh(
    `docker exec estate-postgres psql -U postgres -At -F '|' -d ${db} -c ${JSON.stringify(
      q.replace(/\s+/g, " ").trim(),
    )}`,
  );

const HOUR = 3600 * 1000;
const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;

/** Gaps in hours between consecutive completions, and the shape of them. */
function profile(completedAt) {
  const gaps = [];
  for (let i = 1; i < completedAt.length; i++) {
    gaps.push((completedAt[i] - completedAt[i - 1]) / HOUR);
  }
  gaps.sort((a, b) => a - b);
  return { gaps, p90: pct(gaps, 0.9), median: pct(gaps, 0.5) };
}

/**
 * Is this shop quiet, or stuck?
 *
 * `at` lets the backtest ask the question as it stood on an earlier day, using
 * only what was known then. A rule tuned on data it has already seen will always
 * look like it works.
 */
function verdict(orders, carts, at) {
  const past = orders.filter((t) => t <= at);
  const last = past.length ? past[past.length - 1] : null;
  if (!last) return null; // a shop with no history to compare against

  const { p90, median, gaps } = profile(past.filter((t) => t > at - DAYS * 24 * HOUR));
  if (gaps.length < 5) return null; // too few orders to say what normal is

  const stillHours = (at - last) / HOUR;
  // Twice the shop's usual gap, with a floor of a full day.
  //
  // The 90th percentile was the first try and it was too slow: it includes every
  // quiet weekend the shop has ever had, so on the September stoppage it did not
  // fire until the 19th, four days after the last order. Twice the median is the
  // shop's own rhythm rather than its worst week, and it fires on the second day.
  //
  // Two days is the floor here and it is arithmetic, not tuning. A shop that
  // finishes an order every 19 to 26 hours cannot be shown to have stopped in
  // "a few hours": one quiet evening looks identical. The honest claim is a
  // couple of days, against the five it actually took.
  const trigger = Math.max(24, 2 * median);
  const cartsSince = carts.filter((t) => t > last && t <= at).length;

  if (stillHours > trigger && cartsSince >= 3) {
    return { stillHours, trigger, cartsSince, median, last };
  }
  return null;
}

/**
 * The faster signal: people who reached the card and are still sitting there.
 *
 * Carts against orders needs two days to say anything, and that is arithmetic
 * rather than tuning: a shop that finishes an order every 19 to 26 hours cannot
 * be shown to have stopped in an evening, because one quiet evening looks the
 * same. This looks further down the funnel instead.
 *
 * A customer who reaches the payment step either pays within minutes or leaves.
 * One sitting there is normal. Several sitting there, with nothing completing,
 * is the exact shape of 15 to 21 Sep: every Stripe intent in that window was
 * `requires_payment_method` with no error on it, which means the card was never
 * submitted, and three real customers reached that step and none got through.
 *
 * `stalled` is orders still in `payment` state, so it reads the present rather
 * than replaying history. In the backtest that means it can only be approximated,
 * and the replay says so rather than pretending otherwise.
 */
function paymentVerdict(stalled, orders, at) {
  const recent = stalled.filter((t) => t < at - 2 * HOUR && t > at - 48 * HOUR);
  if (recent.length < 2) return null;
  const completedSince = orders.filter((t) => t > at - 48 * HOUR && t <= at).length;
  if (completedSince > 0) return null;
  return { stuck: recent.length, oldest: Math.round((at - Math.min(...recent)) / HOUR) };
}

const results = [];
for (const shop of shops) {
  const db = `${shop}_shop`;
  let orders = [];
  let carts = [];
  let stalled = [];
  try {
    orders = sql(
      db,
      `SELECT extract(epoch from completed_at) FROM spree_orders
       WHERE completed_at > now() - interval '${DAYS + 10} days'
         AND coalesce(email,'') <> '${PROBE_EMAIL}' ORDER BY completed_at`,
    )
      .split("\n").filter(Boolean).map((s) => Number(s) * 1000);
    // Every cart, with a flag saying whether it is one of ours, decided in SQL so
    // the window is applied to the same rows the count comes from.
    carts = sql(
      db,
      `SELECT extract(epoch from o.created_at), (o.email = '${PROBE_EMAIL}')
         OR EXISTS (SELECT 1 FROM spree_orders p
                    WHERE p.email = '${PROBE_EMAIL}'
                      AND p.created_at BETWEEN o.created_at - interval '${PROBE_WINDOW_MIN} minutes'
                                           AND o.created_at + interval '${PROBE_WINDOW_MIN} minutes')
       FROM spree_orders o
       WHERE o.created_at > now() - interval '${DAYS + 10} days' ORDER BY o.created_at`,
    )
      .split("\n").filter(Boolean)
      .map((line) => line.split("|"))
      .filter(([, ours]) => ours !== "t")
      .map(([t]) => Number(t) * 1000);
    stalled = sql(
      db,
      `SELECT extract(epoch from created_at) FROM spree_orders
       WHERE state = 'payment' AND created_at > now() - interval '${DAYS + 10} days'
         AND coalesce(email,'') <> '${PROBE_EMAIL}' ORDER BY created_at`,
    )
      .split("\n").filter(Boolean).map((s) => Number(s) * 1000);
  } catch {
    results.push({ shop, error: "could not read this shop's database" });
    continue;
  }
  results.push({ shop, orders, carts, stalled });
}

const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

if (BACKTEST) {
  // Walk one day at a time and ask the question as it stood that morning.
  console.log(`\nReplaying ${DAYS} days. A line means this would have been sent.\n`);
  const now = Date.now();
  let fired = 0;
  for (const r of results) {
    if (r.error) { console.log(`  ${r.shop.padEnd(9)} ${r.error}`); continue; }
    const days = [];
    const fast = [];
    for (let d = DAYS; d >= 0; d--) {
      const at = now - d * 24 * HOUR;
      const v = verdict(r.orders, r.carts, at);
      if (v) days.push({ at, v });
      const pv = paymentVerdict(r.stalled, r.orders, at);
      if (pv) fast.push({ at, pv });
    }
    if (fast.length) {
      const fruns = [];
      for (const d of fast) {
        const prev = fruns[fruns.length - 1];
        if (prev && d.at - prev.end <= 36 * HOUR) { prev.end = d.at; prev.n += 1; }
        else fruns.push({ start: d.at, end: d.at, n: 1, pv: d.pv });
      }
      console.log(
        `  ${r.shop.padEnd(9)} card step, ${fruns.length} stall(s): ` +
          fruns
            .map((f) =>
              `${stamp(f.start).slice(5, 10)}${f.n > 1 ? `-${stamp(f.end).slice(5, 10)}` : ""}` +
              ` (${f.pv.stuck} waiting)`)
            .join(", "),
      );
    }
    if (!days.length) { console.log(`  ${r.shop.padEnd(9)} never fires`); continue; }
    fired += 1;
    // Run the days together, because consecutive mornings are one incident and
    // listing them separately makes a single outage look like seven.
    const runs = [];
    for (const d of days) {
      const prev = runs[runs.length - 1];
      if (prev && d.at - prev.end <= 36 * HOUR) { prev.end = d.at; prev.n += 1; }
      else runs.push({ start: d.at, end: d.at, n: 1, v: d.v });
    }
    console.log(`  ${r.shop.padEnd(9)} ${runs.length} incident(s):`);
    for (const run of runs) {
      const span =
        run.n === 1 ? stamp(run.start).slice(0, 10)
                    : `${stamp(run.start).slice(0, 10)} to ${stamp(run.end).slice(0, 10)}`;
      console.log(
        `             ${span}  first alert after ${Math.round(run.v.stillHours)}h with ` +
          `${run.v.cartsSince} carts waiting, normal is one order every ${Math.round(run.v.median)}h`,
      );
    }
  }
  console.log(`\n${fired} shop(s) would have raised an alert in the last ${DAYS} days`);
  process.exit(0);
}

const now = Date.now();
const alerts = [];
const lines = [];
for (const r of results) {
  if (r.error) { lines.push(`  ${r.shop.padEnd(9)} ${r.error}`); continue; }
  const v = verdict(r.orders, r.carts, now);
  if (v) {
    alerts.push({
      shop: r.shop,
      hours: Math.round(v.stillHours),
      carts: v.cartsSince,
      normal: Math.round(v.median),
      // The sentence that goes out. Written here so the thing that sends it
      // does not get to reword it.
      message:
        `${r.shop} has taken no order for ${Math.round(v.stillHours)} hours. ` +
        `${v.cartsSince} carts have been started in that time. ` +
        `It normally takes one every ${Math.round(v.median)} hours.`,
    });
    lines.push(`  ${r.shop.padEnd(9)} STUCK  ${Math.round(v.stillHours)}h, ${v.cartsSince} carts waiting`);
  } else {
    const last = r.orders.length ? r.orders[r.orders.length - 1] : null;
    lines.push(
      `  ${r.shop.padEnd(9)} ok     ${last ? `last order ${Math.round((now - last) / HOUR)}h ago` : "no orders on record"}`,
    );
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ checked: results.length, alerts }, null, 2));
  process.exit(alerts.length ? 1 : 0);
}

console.log("\nCarts started against orders finished\n");
for (const l of lines) console.log(l);
console.log(
  alerts.length
    ? `\n${alerts.length} shop(s) are taking carts and finishing none:\n\n` +
        alerts.map((a) => `  ${a.message}`).join("\n")
    : "\nevery shop is finishing orders at its own normal rate",
);
process.exit(alerts.length ? 1 : 0);
