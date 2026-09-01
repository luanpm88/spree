export const REQUEST_PATHNAME_HEADER = "x-spree-request-pathname";
export const REQUEST_SEARCH_HEADER = "x-spree-request-search";

interface LocalizedRedirectParams {
  country: string;
  locale: string;
  pathname?: string | null;
  search?: string | null;
}

// The country segment is not always an ISO pair. One shop is addressed by its
// own name because it sells to 34 countries and belongs to none of them, and
// `[a-z]{2}` did not match that, so the prefix was never recognised and never
// stripped: the redirect appended a second copy of it and the page answered 307
// to itself until the browser gave up. Measured as
// /nolocal/en -> /nolocal/en/nolocal/en -> ... 5 hops before curl stopped.
const LOCALIZED_PREFIX =
  /^\/[a-z]{2,12}\/[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?=\/|$)/i;

/** Replace only the country/locale prefix while retaining the requested page. */
export function buildLocalizedRedirectPath({
  country,
  locale,
  pathname,
  search,
}: LocalizedRedirectParams): string {
  const prefix = `/${country.toLowerCase()}/${locale}`;
  const matchedPrefix = pathname?.match(LOCALIZED_PREFIX)?.[0];
  const suffix = matchedPrefix ? pathname?.slice(matchedPrefix.length) : "";
  const normalizedSearch = search?.startsWith("?") ? search : "";

  return `${prefix}${suffix || ""}${normalizedSearch}`;
}
