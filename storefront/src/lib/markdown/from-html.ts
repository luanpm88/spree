/**
 * A rendered page, as Markdown.
 *
 * ── why this exists here and not in Rails ───────────────────────────────────
 *
 * The client runs llms.txt and a robots.txt written for AI crawlers, and beside
 * them a rule that hands any page over as Markdown when the caller asks for it
 * with `Accept: text/markdown`. That rule lived in Rack middleware and only ever
 * rewrote responses whose Content-Type was text/html.
 *
 * On 5.6 Rails serves no shop pages, so the middleware had nothing to act on. It
 * was not broken, it was in the wrong building. He worked that out himself while
 * checking AI readiness: "looks like the MarkdownNegotiation file now needs to be
 * done from Next.js".
 *
 * Measured before writing this, on all seven live shops:
 *
 *   Accept: text/markdown -> storefront   text/html
 *   Accept: text/markdown -> Rails host   text/markdown; charset=utf-8
 *
 * ── the rules are ported, not reinvented ────────────────────────────────────
 *
 * Same order and same output as the Ruby it replaces, so a crawler that has read
 * these shops before sees no change in shape. The one thing that had to change is
 * the flag on every regex.
 *
 * Ruby's /m makes the dot match a newline. JavaScript's /m does something else
 * entirely: it makes ^ and $ match at line breaks, and leaves the dot alone.
 * Porting these patterns with /m would have compiled, run, and silently skipped
 * every element with a line break inside it, which on a rendered page is most of
 * them.
 *
 * The equivalent flag is /s, and this project's TypeScript target predates it. So
 * the patterns say [\s\S] where the Ruby said a dot. That needs no flag at all,
 * which means it also cannot be broken later by someone copying a pattern out of
 * here into a context where the flag is missing.
 */

/** Blocks removed whole, before anything is converted. */
const STRIP_WHOLE: Array<[RegExp, string]> = [
  [/<head[^>]*>[\s\S]*?<\/head>/gi, ""],
  [/<script[^>]*>[\s\S]*?<\/script>/gi, ""],
  [/<style[^>]*>[\s\S]*?<\/style>/gi, ""],
  [/<nav[^>]*>[\s\S]*?<\/nav>/gi, ""],
  [/<footer[^>]*>[\s\S]*?<\/footer>/gi, ""],
  [/<header[^>]*>[\s\S]*?<\/header>/gi, ""],
];

/**
 * The named entities the Ruby decoded.
 *
 * Numeric ones are handled separately below, and they had to be: the Ruby list
 * carried `&#39;` and React emits `&#x27;` for the same apostrophe. Ported as it
 * stood, every apostrophe on every page reached the crawler as `&#x27;`. Found by
 * reading what the live shop actually returned, not by reading the port.
 */
const ENTITIES: Array<[RegExp, string]> = [
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&nbsp;/g, " "],
];

export function htmlToMarkdown(html: string): string {
  let out = html;

  for (const [pattern, replacement] of STRIP_WHOLE) {
    out = out.replace(pattern, replacement);
  }

  // Headings
  out = out.replace(
    /<h1[^>]*>([\s\S]*?)<\/h1>/gi,
    (_m, t) => `# ${t.trim()}\n\n`,
  );
  out = out.replace(
    /<h2[^>]*>([\s\S]*?)<\/h2>/gi,
    (_m, t) => `## ${t.trim()}\n\n`,
  );
  out = out.replace(
    /<h3[^>]*>([\s\S]*?)<\/h3>/gi,
    (_m, t) => `### ${t.trim()}\n\n`,
  );
  out = out.replace(
    /<h4[^>]*>([\s\S]*?)<\/h4>/gi,
    (_m, t) => `#### ${t.trim()}\n\n`,
  );

  // Links
  out = out.replace(
    /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, text) => `[${text.trim()}](${href})`,
  );

  // Bold and italic
  out = out.replace(
    /<strong[^>]*>([\s\S]*?)<\/strong>/gi,
    (_m, t) => `**${t.trim()}**`,
  );
  out = out.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_m, t) => `**${t.trim()}**`);
  out = out.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_m, t) => `*${t.trim()}*`);
  out = out.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_m, t) => `*${t.trim()}*`);

  // Lists
  out = out.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_m, t) => `- ${t.trim()}\n`,
  );
  out = out.replace(/<\/ul>/gi, "\n");
  out = out.replace(/<\/ol>/gi, "\n");

  // Paragraphs and line breaks
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n");
  out = out.replace(/<p[^>]*>/gi, "");

  // Whatever tags are left
  out = out.replace(/<[^>]+>/g, "");

  for (const [pattern, replacement] of ENTITIES) {
    out = out.replace(pattern, replacement);
  }

  // Numeric entities, decimal and hexadecimal. React writes &#x27; where the old
  // Ruby list expected &#39;, and a crawler reading this should see an apostrophe
  // either way.
  out = out.replace(/&#(\d+);/g, (_m, code) =>
    String.fromCodePoint(Number.parseInt(code, 10)),
  );
  out = out.replace(/&#x([0-9a-f]+);/gi, (_m, code) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  );

  // Collapse the gaps the stripping leaves behind
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}
