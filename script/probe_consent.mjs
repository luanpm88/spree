#!/usr/bin/env node
// Can a real customer tick the policy consent?
//
// It is a Radix Checkbox, which renders as <button id="policy-consent">, and
// the label uses htmlFor="policy-consent". htmlFor only drives real form
// controls, so clicking the WORDS may do nothing while clicking the 16px box
// works. A customer reads the sentence and clicks the sentence.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rows = f => readFileSync(join(ROOT,f),"utf8").split("\n").filter(l=>l.trim()&&!l.startsWith("#")).map(l=>l.split("|").map(s=>s.trim()));
const dash = v => (v === "-" || !v ? undefined : v);
const A={}; for (const [s,o,p,c,st,po,ph] of rows(".checkout_probes")) A[s]={country:dash(p)??dash(o),city:c,state:dash(st),postal:po,phone:ph};
const S={}; for (const r of rows(".estate")) S[r[0]]={url:r[7]};
const code = process.argv[2] || "au";
const shop = S[code], a = A[code];
const OUT = join(ROOT,`tmp/urgent/${code}-consent`); mkdirSync(OUT,{recursive:true});

const b = await chromium.launch();
const page = await (await b.newContext({ viewport:{width:1440,height:1000} })).newPage();
page.setDefaultTimeout(60000);
const fill = async (s,v) => { const l=page.locator(s).first(); if (await l.count()) await l.fill(v).catch(()=>{}); };

await page.goto(`${shop.url}/products`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(3000);
const href = await page.locator('a[href*="/products/"]').first().getAttribute("href");
await page.goto(new URL(href,shop.url).toString(),{waitUntil:"domcontentloaded"}); await page.waitForTimeout(3500);
await page.getByRole("button",{name:/add to (cart|bag)/i}).first().click(); await page.waitForTimeout(4000);
await page.goto(`${shop.url}/cart`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(3000);
await page.getByRole("link",{name:/checkout/i}).first().click(); await page.waitForTimeout(8000);
const sel = page.locator("#ship-country").first();
if (await sel.count()) await sel.selectOption({label:a.country}).catch(()=>{});
await page.waitForTimeout(1200);
await fill("#email","probe@example.test"); await fill("#ship-first_name","Probe"); await fill("#ship-last_name","Test");
await fill("#ship-address1","1 Queen Street"); await fill("#ship-city",a.city);
const st = page.locator("#ship-state");
if (await st.count() && a.state) await st.first().selectOption({label:a.state}).catch(()=>{});
await fill("#ship-postal_code",a.postal); await fill("#ship-phone",a.phone);
await page.keyboard.press("Tab"); await page.waitForTimeout(15000);

const box = page.locator("#policy-consent");
await box.scrollIntoViewIfNeeded().catch(()=>{});
await page.waitForTimeout(600);

const geo = await box.evaluate(e => {
  const r = e.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
  return { tag: e.tagName, w: Math.round(r.width), h: Math.round(r.height),
           visible: r.width > 0 && r.height > 0,
           topmost: top ? top.tagName + (top.id ? "#"+top.id : "") : "none" };
});
console.log(`box: ${geo.tag} ${geo.w}x${geo.h}px visible=${geo.visible} element-on-top=${geo.topmost}`);

// 1. click the WORDS, which is what a person does
const label = page.locator('label[for="policy-consent"]');
await label.click({ position: { x: 40, y: 8 } }).catch(e => console.log("  label click threw"));
await page.waitForTimeout(800);
console.log(`after clicking the LABEL text : aria-checked=${await box.getAttribute("aria-checked")}`);

// 2. click the box itself
await box.click().catch(()=>{});
await page.waitForTimeout(800);
console.log(`after clicking the BOX        : aria-checked=${await box.getAttribute("aria-checked")}`);

await page.screenshot({ path: `${OUT}/consent.png` });
console.log(`shot tmp/urgent/${code}-consent/consent.png`);
await b.close();
