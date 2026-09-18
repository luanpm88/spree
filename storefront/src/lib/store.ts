/**
 * Centralized store configuration.
 *
 * All store-level environment variables are accessed here so the rest of the
 * codebase has a single source of truth with consistent fallback values.
 */

/**
 * Ensure a URL has a protocol prefix.
 * If the URL doesn't start with http:// or https://, prepend https://.
 */
export function ensureProtocol(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Get the store URL, preferring NEXT_PUBLIC_SITE_URL and falling back to
 * NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL. In development, falls back to
 * http://localhost:3001. Returns undefined in production when unconfigured
 * so misconfiguration surfaces immediately.
 */
export function getStoreUrl(): string | undefined {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (raw) return ensureProtocol(raw);
  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : undefined;
}

/**
 * Get the store name from environment variables.
 */
export function getStoreName(): string {
  return process.env.NEXT_PUBLIC_STORE_NAME || "Spree Store";
}

/**
 * Get the store description from environment variables.
 */
export function getStoreDescription(): string {
  return (
    process.env.NEXT_PUBLIC_STORE_DESCRIPTION ||
    "A modern e-commerce storefront powered by Spree Commerce and Next.js."
  );
}

/**
 * Get the default country ISO code (lowercase).
 */
export function getDefaultCountry(): string {
  return (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || "us").toLowerCase();
}

/**
 * Get the default locale code.
 */
export function getDefaultLocale(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_LOCALE || "en";
}

/**
 * Whether this shop may be browsed at all without an account.
 *
 * The wholesale shop may not: the client's requirement is that a URL forwarded
 * to someone without an account shows them nothing. Retail shops leave this
 * unset and are untouched.
 */
export function isAccountRequired(): boolean {
  const value = (process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT || "").toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Serve every address without the /{country}/{locale} prefix.
 *
 * His decision, in his words: "I am thinking our shops, SEO, and AI search will
 * be much stronger if we have simple, clean URLS. .shop/products/
 * .shop/categories/ No country, no language, and if a shop starts to grow
 * bigger and needs a country or languages, I think we just make the changes then
 * in the right way that will not affect our SEO."
 *
 * DEFAULT OFF, and that is the point of it being a flag rather than an edit.
 * This moves every address on a shop at once, and one of the seven is closed to
 * anyone without an account. Its gate is decided in the middleware, in a branch
 * that today only runs for a request that HAS a prefix, so turning a redirect
 * into a rewrite without moving the gate with it would serve trade prices to
 * anyone holding a link. A flag means each shop is turned on deliberately, with
 * both gates run against it, instead of all seven moving on a deploy.
 */
// Not named useCleanUrls. It was, and Biome's React rules read any `use` prefix
// as a hook, so a plain env-var read broke lint in three files at once with
// "this hook is being called conditionally". The linter was right about the
// name: `use` means something specific in this codebase's other half.
export function cleanUrlsEnabled(): boolean {
  const value = (process.env.NEXT_PUBLIC_CLEAN_URLS || "").toLowerCase();
  return value === "1" || value === "true";
}

/**
 * The addresses a gated shop still serves to a visitor with no account, as
 * paths without the market prefix.
 *
 * Defaults to the four the client named, which are `Spree::Policy` slugs on the
 * wholesale shop and are served at /policies/<slug>. Overridable per shop
 * because the next gated shop may carry different policies, and a list in an
 * env var can be corrected without a code change.
 */
const DEFAULT_PUBLIC_PATHS = [
  "/policies/terms-of-service",
  "/policies/privacy-policy",
  "/policies/returns-policy",
  "/policies/shipping-policy",
];

export function getPublicPaths(): string[] {
  const parsed = (process.env.NEXT_PUBLIC_PUBLIC_PATHS ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => (path.startsWith("/") ? path : `/${path}`))
    .map((path) => path.replace(/\/+$/, ""))
    // "/" is not an exception, it is the whole shop: the market root normalises
    // to "/", so one stray slash in this variable opens the home page of a shop
    // that is meant to be closed. A value like "/" or "//" reduces to the empty
    // string here and is dropped by the filter below.
    .filter(Boolean);

  // An empty result means the variable was absent, blank, or held nothing
  // usable — "," and " , " both parse to nothing. Falling through to the
  // default rather than returning [] matters: [] is not "no exceptions
  // configured", it is "close the four policies a new business has to read
  // before it can apply", which locks the shop against the people it is for.
  return parsed.length > 0 ? parsed : DEFAULT_PUBLIC_PATHS;
}

/**
 * Get the SEO title, preferring STORE_SEO_TITLE and falling back to the
 * store name (NEXT_PUBLIC_STORE_NAME).
 */
export function getStoreSeoTitle(): string {
  return process.env.STORE_SEO_TITLE || getStoreName();
}

/**
 * Get the meta description, preferring STORE_META_DESCRIPTION and falling
 * back to the store description (NEXT_PUBLIC_STORE_DESCRIPTION).
 */
export function getStoreMetaDescription(): string {
  return process.env.STORE_META_DESCRIPTION || getStoreDescription();
}

/**
 * Get the "from" address for transactional emails.
 */
export function getStoreEmailFrom(): string {
  return process.env.EMAIL_FROM || "orders@example.com";
}

/**
 * Returns true when EMAIL_FROM is not set and getStoreEmailFrom() will
 * return the fallback address.
 */
export function isStoreEmailFromFallback(): boolean {
  return !process.env.EMAIL_FROM;
}

/**
 * Which country the checkout should open on.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * It was `countries[0]`, the first country the market returns. On the shops
 * whose market sells to one country that is the right country by accident. The
 * US market also sells to the territories, and the list comes back in
 * alphabetical order, so the US checkout opened on American Samoa.
 *
 * What a customer saw on the live shop, measured on 18 Sep: country American
 * Samoa, a US postcode typed into it, "Shipping address zipcode is invalid" in
 * red, no shipping method offered and a total that stayed at 0.00. Nothing
 * errored anywhere; the shop simply could not be bought from until the customer
 * noticed the country box and changed it.
 *
 * Three cases, in order:
 *
 *   the market sells to the shop's own country   that country
 *   the market has exactly one country           that one
 *   anything else                                nothing, so the customer picks
 *
 * The last case is the rest-of-world shop, which builds with a shop name in
 * NEXT_PUBLIC_DEFAULT_COUNTRY rather than a country code. It was opening on
 * Belgium, first alphabetically of the countries it ships to, and a Belgian
 * postcode is four digits, so a German customer typing five got the same red
 * line as the US one. A shop that sells to thirty countries has no right
 * default, and an empty box says "choose" where a wrong one says nothing.
 */
export function preferredCountryIso(
  countries: { iso: string }[],
  ownCountry: string = getDefaultCountry(),
): string {
  const own = ownCountry.toUpperCase();
  const match = countries.find((c) => c.iso?.toUpperCase() === own);
  if (match) return match.iso;
  if (countries.length === 1) return countries[0].iso;
  return "";
}
