// Render docs/USER_GUIDE.md to docs/USER_GUIDE.pdf.
//
//   node script/build_guide.mjs
//
// Uses Chromium (via Playwright) as the print engine — no pandoc/LaTeX needed.
// Screenshots are inlined as data URIs so the intermediate HTML is portable and
// the PDF never depends on the filesystem at print time.
//
// Run script/capture_screenshots.mjs first, or images render as a placeholder.

import { chromium } from 'playwright';
import MarkdownIt from 'markdown-it';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DOCS = path.resolve('docs');
const SRC = path.join(DOCS, 'USER_GUIDE.md');
const OUT_PDF = path.join(DOCS, 'USER_GUIDE.pdf');
const OUT_HTML = path.join(DOCS, '.user_guide.build.html');

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

// ── inline images as data URIs ───────────────────────────────────────────────
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
const missing = [];

async function inlineImages(html) {
  const srcs = [...new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
  for (const src of srcs) {
    if (/^(data:|https?:)/.test(src)) continue;
    const file = path.resolve(DOCS, src);
    try {
      await stat(file);
      const buf = await readFile(file);
      const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const uri = `data:${mime};base64,${buf.toString('base64')}`;
      html = html.replaceAll(`src="${src}"`, `src="${uri}"`);
    } catch {
      missing.push(src);
      // Leave a visible placeholder rather than a broken-image icon.
      html = html.replaceAll(
        `src="${src}"`,
        `src="data:image/svg+xml;base64,${Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="120"><rect width="100%" height="100%" fill="#fee2e2"/><text x="20" y="68" font-family="monospace" font-size="20" fill="#991b1b">missing screenshot: ${src}</text></svg>`
        ).toString('base64')}"`
      );
    }
  }
  return html;
}

// Markdown "> **X** → …" callouts and tables get styled by CSS below; nothing
// else is transformed, so the .md stays the single source of truth.
const CSS = `
  @page { size: A4; margin: 16mm 14mm 18mm 14mm; }

  :root {
    --ink: #14181f;
    --muted: #5b6472;
    --line: #e2e6ec;
    --accent: #1d4ed8;
    --accent-soft: #eff4ff;
    --code-bg: #f6f8fa;
  }

  * { box-sizing: border-box; }

  body {
    font-family: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, sans-serif;
    font-size: 10.2pt;
    line-height: 1.62;
    color: var(--ink);
    margin: 0;
    -webkit-font-smoothing: antialiased;
  }

  /* ── cover ─────────────────────────────────────────────────────────────── */
  .cover {
    height: 247mm;                 /* fills the first page inside margins */
    display: flex; flex-direction: column; justify-content: center;
    page-break-after: always;
    border-top: 6px solid var(--accent);
  }
  .cover .eyebrow {
    font-size: 9pt; letter-spacing: .18em; text-transform: uppercase;
    color: var(--accent); font-weight: 700; margin-bottom: 14mm;
  }
  .cover h1 {
    font-size: 34pt; line-height: 1.1; margin: 0 0 6mm; border: 0; padding: 0;
    letter-spacing: -.02em;
  }
  .cover .sub { font-size: 13pt; color: var(--muted); margin-bottom: 16mm; }
  .cover dl { display: grid; grid-template-columns: 34mm 1fr; gap: 2.5mm 6mm; font-size: 10pt; margin: 0; }
  .cover dt { color: var(--muted); }
  .cover dd { margin: 0; font-weight: 600; }
  .cover .foot { margin-top: auto; font-size: 9pt; color: var(--muted); }

  /* ── headings ──────────────────────────────────────────────────────────── */
  h1 {
    font-size: 19pt; margin: 0 0 6mm; padding-bottom: 3mm;
    border-bottom: 2.5px solid var(--accent); letter-spacing: -.01em;
    page-break-before: always; page-break-after: avoid;
  }
  h1:first-of-type { page-break-before: avoid; }
  h2 {
    font-size: 13.5pt; margin: 9mm 0 3mm; padding-left: 3mm;
    border-left: 3.5px solid var(--accent); page-break-after: avoid;
  }
  h3 { font-size: 11.4pt; margin: 6mm 0 2mm; page-break-after: avoid; }
  h1 + h2, h2 + h3 { margin-top: 4mm; }

  p { margin: 0 0 3mm; orphans: 3; widows: 3; }
  strong { font-weight: 700; }

  a { color: var(--accent); text-decoration: none; }

  /* ── code ──────────────────────────────────────────────────────────────── */
  code {
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: .87em; background: var(--code-bg);
    padding: .1em .34em; border-radius: 3px;
  }
  pre {
    background: var(--code-bg); border: 1px solid var(--line); border-radius: 5px;
    padding: 3.5mm 4mm; overflow: hidden; margin: 0 0 4mm;
    page-break-inside: avoid; white-space: pre-wrap; word-wrap: break-word;
  }
  pre code { background: none; padding: 0; font-size: 8.3pt; line-height: 1.5; }

  /* ── tables ────────────────────────────────────────────────────────────── */
  table {
    width: 100%; border-collapse: collapse; margin: 0 0 4mm;
    font-size: 9.1pt; page-break-inside: avoid;
  }
  th, td {
    border: 1px solid var(--line); padding: 1.9mm 2.6mm;
    text-align: left; vertical-align: top;
  }
  th { background: var(--accent-soft); font-weight: 700; }
  tbody tr:nth-child(even) { background: #fafbfc; }
  /* image-in-table layouts (the "vận hành khác" grid) */
  td img { margin: 0; }

  /* ── callouts ──────────────────────────────────────────────────────────── */
  blockquote {
    margin: 0 0 4mm; padding: 3mm 4mm;
    background: var(--accent-soft); border-left: 3.5px solid var(--accent);
    border-radius: 0 4px 4px 0; page-break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }
  blockquote ul { margin-bottom: 0; }

  ul, ol { margin: 0 0 4mm; padding-left: 6mm; }
  li { margin-bottom: 1.2mm; }

  /* ── screenshots ───────────────────────────────────────────────────────── */
  img {
    max-width: 100%; height: auto; display: block;
    margin: 3mm 0 1.5mm; border: 1px solid var(--line); border-radius: 5px;
  }
  /* The caption is the italic text markdown-it leaves after an image; we build
     figures explicitly instead — see wrapImages(). */
  figure { margin: 0 0 5mm; page-break-inside: avoid; }
  figure img { margin-bottom: 1.5mm; }
  figcaption { font-size: 8.4pt; color: var(--muted); font-style: italic; }

  hr { border: 0; border-top: 1px solid var(--line); margin: 7mm 0; }

  /* Keep a heading with the paragraph that follows it. */
  h1, h2, h3 { break-after: avoid-page; }
`;

// Turn `<p><img alt="X" src="…"></p>` into a real figure with a caption, so the
// alt text becomes a visible caption in print.
function wrapImages(html) {
  return html.replace(
    /<p>(<img [^>]*alt="([^"]*)"[^>]*>)<\/p>/g,
    (_, img, alt) =>
      `<figure>${img}${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`
  );
}

const run = async () => {
  const raw = await readFile(SRC, 'utf8');

  // Drop the H1 + the metadata lines right under it; the cover page replaces them.
  const body = raw.replace(/^#[^\n]*\n(?:(?:\*\*[^\n]*\n)|\n)*/, '');

  let html = md.render(body);
  html = wrapImages(html);
  html = await inlineImages(html);

  const cover = `
    <div class="cover">
      <div class="eyebrow">Tài liệu nội bộ · b-teka</div>
      <h1>Spree Commerce<br>Hướng dẫn toàn tập</h1>
      <div class="sub">Nền tảng thương mại điện tử B2B &amp; B2C</div>
      <dl>
        <dt>Spree</dt><dd>5.6.1 Community Edition</dd>
        <dt>Nền tảng</dt><dd>Rails 8.1.3 · Ruby 4.0.1 · PostgreSQL 18</dd>
        <dt>Hạ tầng</dt><dd>Docker</dd>
        <dt>Repository</dt><dd>github.com/luanpm88/spree</dd>
        <dt>Cập nhật</dt><dd>30/07/2026</dd>
      </dl>
      <div class="foot">
        Ảnh chụp trong tài liệu được lấy trực tiếp từ hệ thống đã dựng.
      </div>
    </div>`;

  const doc = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
    <title>Spree — Hướng dẫn toàn tập</title><style>${CSS}</style></head>
    <body>${cover}${html}</body></html>`;

  await writeFile(OUT_HTML, doc);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${OUT_HTML}`, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });

  await page.pdf({
    path: OUT_PDF,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:7.5pt;color:#8b94a3;width:100%;padding:0 14mm;
      font-family:-apple-system,sans-serif;">Spree — Hướng dẫn toàn tập</div>`,
    // Group the page counter in ONE flex child — otherwise space-between pushes
    // the number, the slash and the total to opposite ends of the page.
    footerTemplate: `<div style="font-size:7.5pt;color:#8b94a3;width:100%;padding:0 14mm;
      font-family:-apple-system,sans-serif;display:flex;justify-content:space-between;">
      <span>github.com/luanpm88/spree</span>
      <span>trang <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
    margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
  });

  await browser.close();

  const { size } = await stat(OUT_PDF);
  const imgCount = [...doc.matchAll(/<img /g)].length;
  console.log(`\nPDF: docs/USER_GUIDE.pdf  (${(size / 1024 / 1024).toFixed(1)} MB, ${imgCount} images)`);
  if (missing.length) {
    console.log(`\nWARNING — ${missing.length} screenshot(s) missing, rendered as placeholders:`);
    missing.forEach((m) => console.log(`  ${m}`));
    console.log('  fix: node script/capture_screenshots.mjs');
  }
};

run().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
