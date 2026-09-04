export const REQUEST_PATHNAME_HEADER = "x-spree-request-pathname";
export const REQUEST_SEARCH_HEADER = "x-spree-request-search";

/**
 * Set by the middleware when the address carries NO market prefix.
 *
 * Without it this file has to guess whether a pathname begins with a market,
 * and on a clean-URL shop it guessed wrong in the direction that loses the page
 * the visitor asked for. See the note on buildLocalizedRedirectPath.
 */
export const REQUEST_CLEAN_URLS_HEADER = "x-spree-clean-urls";

interface LocalizedRedirectParams {
  country: string;
  locale: string;
  pathname?: string | null;
  search?: string | null;
  /**
   * True when `pathname` is already the path WITHIN the market, with no
   * /{country}/{locale} in front of it. Read from REQUEST_CLEAN_URLS_HEADER
   * rather than worked out here.
   */
  cleanUrls?: boolean;
}

// The country segment is not always an ISO pair. One shop is addressed by its
// own name because it sells to 34 countries and belongs to none of them, and
// `[a-z]{2}` did not match that, so the prefix was never recognised and never
// stripped: the redirect appended a second copy of it and the page answered 307
// to itself until the browser gave up. Measured as
// /nolocal/en -> /nolocal/en/nolocal/en -> ... 5 hops before curl stopped.
const LOCALIZED_PREFIX =
  /^\/[a-z]{2,12}\/[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?=\/|$)/i;

/**
 * Replace only the country/locale prefix while retaining the requested page.
 *
 * ── the fault this comment exists for ──────────────────────────────────────
 *
 * On a clean-URL shop the pathname handed to this function has NO market
 * prefix: it is `/products/some-bottle`. The regex below then matched nothing,
 * `suffix` fell to "", and the whole thing returned `/ca/en`. The page the
 * visitor asked for was thrown away.
 *
 * What that did to a real shop, measured on 4 Sep on the live Canada storefront
 * from a Cloudflare edge in Amsterdam:
 *
 *   200 /products/some-bottle-with-a-lid   the product page renders
 *   <meta http-equiv="refresh" content="1;url=/ca/en">
 *   308 /ca/en                                     clean URLs send that to /
 *   200 /                                          the visitor is on the home page
 *
 * The middleware picks the market from `cf-ipcountry`, so a visitor in a country
 * the shop has no Market for is rewritten to `/nl/en/products/...`, this layout
 * cannot serve it, and it redirects them to the default market. Losing the path
 * turns that into "everyone outside this shop's own country lands on the home
 * page, from every link they follow". It happens with JavaScript disabled, which
 * is how a crawler sees it.
 *
 * ── why the prefix is told, not guessed ────────────────────────────────────
 *
 * Making the regex fall back to "keep the whole path" is not enough, because it
 * cannot tell a market prefix from a page. `/pages/faq` matches LOCALIZED_PREFIX
 * exactly as well as `/ca/en` does: two segments, the first 2 to 12 letters, the
 * second 2 to 3. Guessing would keep some paths and silently eat others.
 *
 * So the middleware, which is the only thing that knows what it stripped, says
 * so. `cleanUrls` true means the pathname is already the in-market path and all
 * of it is kept. Absent, the regex still runs, so shops addressed with a prefix
 * behave exactly as before.
 */
export function buildLocalizedRedirectPath({
  country,
  locale,
  pathname,
  search,
  cleanUrls,
}: LocalizedRedirectParams): string {
  const prefix = `/${country.toLowerCase()}/${locale}`;
  const normalizedSearch = search?.startsWith("?") ? search : "";

  let suffix: string;
  if (cleanUrls) {
    // The whole path, minus a lone "/" which would leave a trailing slash on
    // the market root and make /ca/en/ compete with /ca/en.
    suffix = pathname && pathname !== "/" ? pathname : "";
  } else {
    const matchedPrefix = pathname?.match(LOCALIZED_PREFIX)?.[0];
    suffix = (matchedPrefix ? pathname?.slice(matchedPrefix.length) : "") || "";
  }

  return `${prefix}${suffix}${normalizedSearch}`;
}
