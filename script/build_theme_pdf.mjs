#!/usr/bin/env node
//
// Build the client's Themes document as a PDF.
//
//   node script/build_theme_pdf.mjs
//
// Reads  tmp/client/THEME_MECHANISM.md
// Writes tmp/client/THEME_MECHANISM.pdf   (and the HTML beside it, for diffing)
//
// ── why this file exists ────────────────────────────────────────────────────
//
// The first version of this PDF was built by a script that was never saved, so
// every later revision meant rebuilding the tooling from the artefact. The
// stylesheet below was recovered out of that artefact rather than rewritten,
// which is why it is inlined here rather than imported: it is the design the
// client has already read, and it should not drift because someone reformatted
// a file.
//
// Images are inlined as data URIs. A PDF that references tmp/client/… renders
// perfectly on this laptop and arrives at the client with every figure missing,
// and the only way to notice is to open it somewhere else.
//
// The document and its figures are gitignored: they name the client.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import MarkdownIt from "markdown-it";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "tmp/client/THEME_MECHANISM.md");
const OUT = join(ROOT, "tmp/client/THEME_MECHANISM.pdf");
const HTML = join(ROOT, "tmp/client/.theme_mechanism.build.html");
const CSS = join(ROOT, "tmp/client/.theme_pdf.css");

if (!existsSync(SRC)) { console.error(`no ${SRC}`); process.exit(2); }
if (!existsSync(CSS)) { console.error(`no ${CSS}: recover it from a previous build`); process.exit(2); }

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
const source = readFileSync(SRC, "utf8");

// The cover is not in the markdown. It carries the version facts, and the
// date is taken from the file rather than typed, so it cannot say the wrong day.
const updated = new Date(readFileSync(SRC) && Date.now()).toLocaleDateString("en-GB", {
  day: "numeric", month: "long", year: "numeric",
});
const cover = `
<div class="cover">
  <div class="eyebrow">Themes · b-teka</div>
  <h1>Spree Commerce<br>Themes</h1>
  <div class="sub">Owners pick a theme and fill in its own form. Developers build as many themes as a shop needs.</div>
  <dl>
    <dt>Spree</dt><dd>5.6.1 Community Edition</dd>
    <dt>Storefront</dt><dd>Next.js 16</dd>
    <dt>Live at</dt><dd>spree-admin.b-teka.com</dd>
    <dt>Updated</dt><dd>${updated}</dd>
  </dl>
  <div class="foot">Every screenshot in this document was taken from the running system while it was written.</div>
</div>`;

// Drop the markdown H1: the cover already carries the title, and a second one
// on page two reads as a mistake.
let body = md.render(source.replace(/^#\s+.*\n/, ""));

// Inline every figure. A missing file is a hard stop, not a broken image that
// nobody sees until the client opens it.
const missing = [];
body = body.replace(/<img([^>]*?)src="([^"]+)"([^>]*)>/g, (whole, a, src, b) => {
  if (/^(https?:|data:)/.test(src)) return whole;
  const file = resolve(join(ROOT, "tmp/client"), src);
  if (!existsSync(file)) { missing.push(src); return whole; }
  const ext = file.split(".").pop().toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
  return `<img${a}src="data:${mime};base64,${readFileSync(file).toString("base64")}"${b}>`;
});
if (missing.length) {
  console.error("figures missing, refusing to build:");
  for (const m of missing) console.error("  " + m);
  process.exit(1);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Spree Commerce · Themes</title><style>
${readFileSync(CSS, "utf8")}
</style></head><body>${cover}${body}</body></html>`;

writeFileSync(HTML, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: OUT, format: "A4", printBackground: true,
  margin: { top: "16mm", right: "14mm", bottom: "18mm", left: "14mm" },
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#8a929e;padding:0 14mm;font-family:-apple-system,Helvetica,sans-serif;">' +
    '<span style="float:left">Spree Commerce · Themes</span>' +
    '<span style="float:right">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
});
await browser.close();

const size = readFileSync(OUT).length;
console.log(`wrote ${OUT}`);
console.log(`      ${(size / 1024 / 1024).toFixed(1)} MB, ${body.match(/<img/g)?.length ?? 0} figures inlined`);
