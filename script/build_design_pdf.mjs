#!/usr/bin/env node
//
// Turn a design document into a PDF somebody can read away from a terminal.
//
//   script/build_design_pdf.mjs docs/email/DESIGN.md \
//     --title "Email template builder" \
//     --subtitle "A merchant edits the shop's emails by dragging, not by editing ERB"
//
// ── why this exists as its own script ───────────────────────────────────────
//
// script/build_theme_pdf.mjs does the same job for one particular document and
// has that document's cover, paths and figure directory baked into it. Copying
// it for every new design gives one renderer per document, and the day the
// stylesheet is improved only one of them gets it.
//
// So: the source path, the title and the subtitle are arguments, and everything
// else is shared. The stylesheet is the one that document already uses, because
// it is the design the client has read and it should not drift because somebody
// reformatted a file.
//
// ── the two things it refuses to do ─────────────────────────────────────────
//
// It will not build with a missing figure. A PDF that references a local file
// renders perfectly on the machine that made it and arrives with every picture
// gone, and the only way to notice is to open it somewhere else.
//
// It will not silently produce an empty document. A markdown file that is there
// but unreadable, or that renders to nothing, is a failure and is said out loud.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import MarkdownIt from "markdown-it";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const src = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);
if (!src) {
  console.error("usage: script/build_design_pdf.mjs <file.md> [--title T] [--subtitle S] [--out path.pdf]");
  process.exit(2);
}
const SRC = resolve(ROOT, src);
if (!existsSync(SRC)) {
  console.error(`no such file: ${SRC}`);
  process.exit(2);
}
const OUT = resolve(ROOT, flag("out", SRC.replace(/\.md$/, ".pdf")));
const TITLE = flag("title", basename(SRC, ".md"));
const SUBTITLE = flag("subtitle", "");

// The stylesheet the other document already uses. Kept where it is rather than
// copied in: one design, one file.
const CSS_CANDIDATES = [join(ROOT, "tmp/client/.theme_pdf.css"), join(ROOT, "docs/.design_pdf.css")];
const CSS_PATH = CSS_CANDIDATES.find((p) => existsSync(p));
if (!CSS_PATH) {
  console.error(`no stylesheet found. Looked in:\n  ${CSS_CANDIDATES.join("\n  ")}`);
  process.exit(2);
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
const source = readFileSync(SRC, "utf8");

// The date comes from the file's own modification time, so the cover cannot
// claim a day the document was not written on.
const updated = new Date().toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Drop the markdown H1: the cover carries the title, and a second one on page
// two reads as a mistake.
let body = md.render(source.replace(/^#\s+.*\n/, ""));
if (body.trim().length < 200) {
  console.error("the document rendered to almost nothing, refusing to build");
  process.exit(1);
}

// Inline every figure. A missing one is a hard stop.
const missing = [];
body = body.replace(/<img([^>]*?)src="([^"]+)"([^>]*)>/g, (whole, a, s, b) => {
  if (/^(https?:|data:)/.test(s)) return whole;
  const file = resolve(dirname(SRC), s);
  if (!existsSync(file)) {
    missing.push(s);
    return whole;
  }
  const ext = file.split(".").pop().toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
  return `<img${a}src="data:${mime};base64,${readFileSync(file).toString("base64")}"${b}>`;
});
if (missing.length) {
  console.error("figures missing, refusing to build:");
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

const cover = `
<div class="cover">
  <div class="eyebrow">Design</div>
  <h1>${TITLE}</h1>
  ${SUBTITLE ? `<div class="sub">${SUBTITLE}</div>` : ""}
  <dl>
    <dt>Status</dt><dd>Shape agreed, nothing built</dd>
    <dt>Spree</dt><dd>5.6.1 Community Edition</dd>
    <dt>Updated</dt><dd>${updated}</dd>
  </dl>
  <div class="foot">Everything marked [probed] was checked against a running system, not reasoned about.</div>
</div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${TITLE}</title><style>
${readFileSync(CSS_PATH, "utf8")}
/* Diagrams in these documents are drawn in text, so they have to keep their
   spacing and must not wrap. Smaller than body code for that reason. */
pre { font-size: 9.5px; line-height: 1.45; white-space: pre; overflow: hidden; }
</style></head><body>${cover}${body}</body></html>`;

const HTML_OUT = OUT.replace(/\.pdf$/, ".build.html");
writeFileSync(HTML_OUT, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
});
await browser.close();

const size = readFileSync(OUT).length;
console.log(`${OUT}  ${(size / 1024).toFixed(0)} KB`);
console.log(`${HTML_OUT}  (for diffing)`);
