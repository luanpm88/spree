import { connection } from "next/server";
import { generateSitemaps } from "@/app/sitemap";
import { getStoreUrl } from "@/lib/store";

/**
 * The sitemap index, at the address the rest of the world already uses.
 *
 * ── why this route exists ────────────────────────────────────────────────────
 *
 * `sitemap.ts` exports `generateSitemaps`, which is how Next splits a large
 * catalogue into bounded files. That is correct, and it has one consequence
 * nobody sees until it matters: the sitemap is served at /sitemap/0.xml and
 * NOTHING answers /sitemap.xml.
 *
 * /sitemap.xml is the address a shop's robots.txt names, the address already
 * submitted to Search Console, and the first thing a crawler tries. On a shop
 * being migrated it is also the address that worked yesterday. Leaving it as a
 * 404 loses the sitemap silently: no error anywhere, the file simply stops being
 * found.
 *
 * ── why it does not live at src/app/sitemap.xml ──────────────────────────────
 *
 * Next reserves that name for the metadata convention, and `sitemap.ts` already
 * claims it even though nothing answers there. Putting a route handler at
 * src/app/sitemap.xml fails the build with "Conflicting route and metadata at
 * /sitemap.xml". So the handler lives here and next.config rewrites the public
 * address onto it, in `beforeFiles` so the rewrite is considered ahead of the
 * filesystem rather than only after it has already 404ed.
 *
 * ── why an index rather than a redirect ──────────────────────────────────────
 *
 * A redirect to /sitemap/0.xml is right only while there is exactly one chunk.
 * The moment the catalogue crosses the split, chunk 1 exists and a redirect
 * hides it. An index is correct at every size, which is what the sitemap
 * protocol has this document type for.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(): Promise<Response> {
  // Not `export const dynamic = "force-dynamic"`: that is rejected outright under
  // cacheComponents, which this app runs with. `connection()` is the replacement,
  // and it is what the rest of this codebase already uses to say "wait for a real
  // request". The chunk count comes from the catalogue, so this cannot be
  // answered at build time.
  await connection();

  const baseUrl = (getStoreUrl() || "").replace(/\/$/, "");
  if (!baseUrl) {
    // No site URL configured, so every entry would be a relative address the
    // protocol does not allow. An empty index is valid and honest; a broken one
    // is neither.
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" />',
      { headers: { "Content-Type": "application/xml" } },
    );
  }

  const sitemaps = await generateSitemaps();
  const entries = sitemaps
    .map(
      (s) =>
        `  <sitemap><loc>${xmlEscape(`${baseUrl}/sitemap/${s.id}.xml`)}</loc></sitemap>`,
    )
    .join("\n");

  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      `${entries}\n` +
      "</sitemapindex>",
    {
      headers: {
        "Content-Type": "application/xml",
        // Short, because the chunk count follows the catalogue.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
