import { chromium } from "playwright";
const OUT = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
const errs = [];
p.on("response", r => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url().slice(0,70)}`); });
const r = await p.goto(process.env.SHOT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(7000);
console.log("landed:", p.url(), "status:", r ? r.status() : "?");
console.log("title:", await p.title());
const c = await p.evaluate(() => ({
  logoImg: document.querySelector("header img")?.getAttribute("src") ?? "(khong co anh logo)",
  images: document.querySelectorAll("img").length,
  decoded: [...document.querySelectorAll("img")].filter(i => i.naturalWidth > 0).length,
  headings: [...document.querySelectorAll("h1,h2,h3")].map(h => h.textContent.trim()).filter(Boolean).slice(0, 14),
  bodyChars: document.body.innerText.trim().length,
}));
console.log(JSON.stringify(c, null, 2));
if (errs.length) console.log("loi request:", errs.slice(0, 5).join(" | "));
await p.screenshot({ path: OUT, fullPage: true });
await b.close();
