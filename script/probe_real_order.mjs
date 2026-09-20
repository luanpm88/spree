#!/usr/bin/env node
// Open a REAL customer's abandoned checkout and photograph what they saw.
//
// Every probe so far built its own order, so every probe measured an order
// built by the probe. This one opens an order a customer built and left, which
// is the only way to see the page that actually stopped them. It clicks
// nothing that could submit or mutate: it reads.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2];
const token = process.argv[3];
const label = process.argv[4] || "real";
if (!base || !token) { console.error("usage: probe_real_order.mjs <base-url> <cart_token> [label]"); process.exit(2); }

const OUT = join(ROOT, `tmp/urgent/${label}`);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  recordVideo: { dir: OUT, size: { width: 1440, height: 1100 } },
});
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

const console_ = [], errs = [], net = [];
page.on("console", m => { if (m.type() === "error") console_.push(m.text().slice(0, 200)); });
page.on("pageerror", e => errs.push(String(e.message).slice(0, 200)));
page.on("response", r => {
  const u = r.url();
  if (/stripe\.com/.test(u)) net.push(`${r.status()} ${u.replace(/\?.*/, "").slice(0, 90)}`);
  else if (r.status() >= 400 && !/favicon/.test(u)) net.push(`HTTP ${r.status()} ${u.slice(0, 90)}`);
});

const url = `${base.replace(/\/$/, "")}/checkout/${token}`;
console.log("opening", url);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${OUT}/01-checkout-top.png` });
await page.screenshot({ path: `${OUT}/02-checkout-full.png`, fullPage: true });

// What does the page actually offer? Read, do not press.
const seen = await page.evaluate(() => {
  const txt = (el) => (el?.innerText || "").replace(/\s+/g, " ").trim();
  const btns = [...document.querySelectorAll("button")].map(b => ({
    label: txt(b).slice(0, 50), disabled: b.disabled,
    visible: !!(b.offsetWidth || b.offsetHeight),
  })).filter(b => b.label);
  return {
    title: document.title,
    heading: txt(document.querySelector("h1, h2")),
    frames: [...document.querySelectorAll("iframe")].map(f => (f.name || f.src || "").slice(0, 70)),
    buttons: btns,
    consent: (() => { const c = document.getElementById("policy-consent");
      return c ? `${c.tagName} aria-checked=${c.getAttribute("aria-checked")}` : "ABSENT"; })(),
    bodyLen: document.body.innerText.length,
    mentionsTotal: /total/i.test(document.body.innerText),
  };
});

console.log("\n--- page");
console.log("title   :", seen.title);
console.log("heading :", seen.heading);
console.log("body    :", seen.bodyLen, "chars, mentions total:", seen.mentionsTotal);
console.log("consent :", seen.consent);
console.log("iframes :", seen.frames.length ? seen.frames.join("\n          ") : "NONE");
console.log("buttons :");
for (const b of seen.buttons) console.log(`   [${b.disabled ? "DISABLED" : "enabled "}] ${b.visible ? "  " : "hidden"} ${b.label}`);
console.log("\n--- stripe / failed requests");
for (const n of [...new Set(net)]) console.log("  ", n);
console.log("\n--- console errors");
for (const c of [...new Set(console_)].slice(0, 12)) console.log("  ", c);
console.log("\n--- page errors");
for (const e of [...new Set(errs)].slice(0, 12)) console.log("  ", e);

await ctx.close();
await browser.close();
console.log("\nshots + video in", OUT);
