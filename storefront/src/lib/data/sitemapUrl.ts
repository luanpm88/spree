/**
 * Make a URL safe to sit inside a sitemap tag.
 *
 * ── the fault this exists for ────────────────────────────────────────────────
 *
 * The client read the sitemap and it did not parse:
 *
 *     https://<shop>/sitemap/0.xml
 *     not well-formed (invalid token): line 114, column 199
 *
 * Three of his product photographs are named with an ampersand in them, for
 * example "Bamboo-&-S.S.-Lid--FRONT-HANDLE-DOWN.jpg". ActiveStorage keeps the
 * original filename in the URL path, Next writes that URL into <image:loc>
 * verbatim, and a bare "&" is not valid XML. So the whole document was rejected
 * by any parser, on every shop, while looking perfectly normal to a person.
 *
 * ── why percent-encoding rather than XML-escaping ────────────────────────────
 *
 * Escaping to "&amp;" also works today, and was the client's own suggestion.
 * It was not taken, for one reason: Next writes the tags, not us. The day its
 * serialiser starts escaping, every URL we pre-escaped becomes "&amp;amp;" and
 * the sitemap breaks the other way. Nothing in our tests would notice, because
 * the document would still parse.
 *
 * Percent-encoding has no such coupling. "%26" is a valid URL, it is already
 * XML-safe, and it stays correct whether or not anything downstream escapes.
 *
 * Verified rather than assumed, on his own file: the literal "&" URL and the
 * "%26" URL both return 200 and the same 75463 bytes, so nothing needs renaming
 * and no existing link changes.
 *
 * ── what is deliberately NOT encoded ────────────────────────────────────────
 *
 * "%" itself. 71 of the 215 image URLs in one shop's sitemap already contain
 * percent-encoded characters, from the signed ActiveStorage blob key. Encoding
 * "%" would turn those into "%25..." and every one of them would 404.
 *
 * The query string, if there ever is one. An "&" there separates parameters and
 * percent-encoding it would change the request. There are zero query strings in
 * these URLs today, ActiveStorage proxy URLs do not use them, and if that ever
 * changes the test beside this file fails rather than shipping broken XML.
 */

/** Characters that end an XML text node early, and their percent forms. */
const UNSAFE_IN_PATH: Array<[RegExp, string]> = [
  [/&/g, "%26"],
  [/</g, "%3C"],
  [/>/g, "%3E"],
];

export function sitemapSafeUrl(url: string): string {
  const cut = url.indexOf("?");
  const path = cut === -1 ? url : url.slice(0, cut);
  const query = cut === -1 ? "" : url.slice(cut);

  let safe = path;
  for (const [pattern, replacement] of UNSAFE_IN_PATH) {
    safe = safe.replace(pattern, replacement);
  }
  return safe + query;
}

/**
 * True when a string still holds something that would break XML.
 *
 * Used by the test to assert the whole set, and worth keeping exported: it is
 * the question the client asked, and it is cheaper to answer here than by
 * fetching a sitemap and parsing it.
 */
export function breaksXml(value: string): boolean {
  return /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)|[<>]/.test(value);
}
