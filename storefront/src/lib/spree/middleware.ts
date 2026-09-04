import { type NextRequest, NextResponse } from "next/server";
import {
  canonicalizeLocale,
  matchLocale,
  negotiateAcceptLanguage,
  negotiateLocale,
} from "@/i18n/normalize";
import {
  REQUEST_CLEAN_URLS_HEADER,
  REQUEST_PATHNAME_HEADER,
  REQUEST_SEARCH_HEADER,
} from "@/i18n/routing";
import { buildAccountLoginHref } from "@/lib/utils/account-redirect";

const COUNTRY_COOKIE = "spree_country";
const LOCALE_COOKIE = "spree_locale";
const ACCESS_TOKEN_COOKIE = "_spree_jwt";
const REFRESH_TOKEN_COOKIE = "_spree_refresh_token";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const HAS_COUNTRY_LOCALE =
  /^\/([a-z]{2})\/([a-z]{2,3}(?:-[a-z0-9]{2,8})*)(\/|$)/i;

/**
 * The same test, for a shop whose country segment is not an ISO pair.
 *
 * One shop sells to 34 countries and is based in none of them, so it is
 * addressed by its own name. The two-letter test above did not match that, the
 * middleware decided the path carried no prefix, and it prepended one to a path
 * that already had it: /nolocal/en became /nolocal/en/nolocal/en, and again,
 * until the browser stopped following. Every page of that shop was unreachable
 * and nothing logged a thing.
 *
 * Built from the configured country rather than by loosening the pattern to
 * `[a-z]{2,12}`. Loosening it would also match a real first segment: /products
 * /abc would parse as country "products", locale "abc". This matches one exact
 * word, the one this build was made for, so nothing else can be mistaken for a
 * country.
 */
function matchCountryLocale(pathname: string, defaultCountry: string) {
  const strict = pathname.match(HAS_COUNTRY_LOCALE);
  if (strict) return strict;
  if (!defaultCountry || /^[a-z]{2}$/i.test(defaultCountry)) return null;
  const escaped = defaultCountry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return pathname.match(
    new RegExp(`^/(${escaped})/([a-z]{2,3}(?:-[a-z0-9]{2,8})*)(/|$)`, "i"),
  );
}

export interface SpreeMiddlewareConfig {
  /**
   * Serve every address without the /{country}/{locale} prefix.
   *
   * Default off. See cleanUrlsEnabled() in lib/store for why this is a flag: it
   * moves every address on a shop at once, and it moves the gate of the closed
   * one, so each shop is turned on deliberately with both gates run against it.
   */
  cleanUrls?: boolean;
  /** Default country ISO code (default: 'us') */
  defaultCountry?: string;
  /** Default locale code (default: 'en') */
  defaultLocale?: string;
  /** Locale codes for which the storefront has message bundles. */
  supportedLocales?: readonly string[];
  /** Routes to skip — prefixes matched with startsWith (default: ['/_next', '/api', '/favicon.ico']) */
  staticRoutes?: string[];
  /** JWT cookie used to identify a potentially authenticated account request. */
  accessTokenCookieName?: string;
  /** Refresh-token cookie used to preserve recoverable account sessions. */
  refreshTokenCookieName?: string;
  /**
   * Put the whole shop behind the login, not only the account pages.
   * Off unless a shop asks for it, so the retail shops are unaffected.
   */
  requireAccount?: boolean;
  /**
   * Addresses that stay reachable on a gated shop, without the market prefix
   * (`/policies/privacy-policy`). The sign-in and sign-up pages are always
   * reachable and do not need listing.
   */
  publicPaths?: readonly string[];
}

const PUBLIC_ACCOUNT_PATHS = new Set([
  "/account",
  "/account/register",
  "/account/forgot-password",
  "/account/reset-password",
]);

/**
 * The only addresses with an extension that a closed shop serves to a visitor
 * with no account. Browser and crawler furniture, none of it about the shop.
 *
 * Everything else with a dot in it goes through the gate, because a dot is not
 * evidence of a file: /products/1.5l-drum has one and is a product page.
 */
const ALWAYS_A_FILE = new Set([
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/icon.png",
  "/manifest.json",
  "/site.webmanifest",
  // These two reach their handlers on a closed shop as well, and it is worth
  // saying why, because the first attempt gated them and that was worse.
  //
  // Gated, /robots.txt answered 307. A crawler reads a redirect there as "this
  // site has no robots.txt" and proceeds as though everything were permitted,
  // so withholding the file grants more than serving it. What must not happen
  // is the file DESCRIBING the shop, and that is now decided where it belongs:
  // robots.ts returns Disallow: / and names no sitemap, and sitemap.ts returns
  // an empty list. Both check isAccountRequired() themselves.
  "/robots.txt",
  "/sitemap.xml",
]);

/** The chunked sitemap files, /sitemap/0.xml. Empty on a closed shop, same as the index. */
const SITEMAP_SHARD = /^\/sitemap\/\d+\.xml$/;

/** The path as the shop sees it: market prefix removed, no trailing slash. */
export function pathWithinMarket(pathname: string, localizedPrefix: string) {
  return pathname.slice(localizedPrefix.length).replace(/\/+$/, "") || "/";
}

function isProtectedAccountPath(pathname: string, localizedPrefix: string) {
  const normalizedPath = pathWithinMarket(pathname, localizedPrefix);

  return (
    normalizedPath.startsWith("/account/") &&
    !PUBLIC_ACCOUNT_PATHS.has(normalizedPath)
  );
}

/**
 * Whether a gated shop may serve this address to someone who is not signed in.
 *
 * ── what the client asked for, in his words ──────────────────────────────────
 *
 * "No URL should be able to be seen without first login in. If a user sends a
 * URL to a friend, they should not be allowed to see it until they have an
 * account. The URLs with the bypass exception are: terms-of-service,
 * privacy-policy, returns-policy, shipping-policy. These pages are needed when
 * a new business signs up for an account."
 *
 * So the rule is deny-by-default and the exception list is his, not ours. The
 * four he named are `Spree::Policy` records on this shop, checked against the
 * database rather than assumed: their slugs are exactly those four words and
 * they are served at /policies/<slug>.
 *
 * The sign-in, sign-up, forgot-password and reset-password pages are open as
 * well, and are not part of his list because they are not a policy decision: a
 * gate that hides its own login has no way in, and the second half of his
 * sentence is about a business being able to sign up.
 */
export function isPublicOnGatedShop(
  pathname: string,
  localizedPrefix: string,
  publicPaths: readonly string[],
) {
  const path = pathWithinMarket(pathname, localizedPrefix);

  if (PUBLIC_ACCOUNT_PATHS.has(path)) return true;

  return publicPaths.includes(path);
}

/**
 * Set spree_country / spree_locale cookies on a response so that
 * `getLocaleOptions()` reads values matching the URL during SSR.
 */
function setLocaleCookies(
  response: NextResponse,
  country: string,
  locale: string,
): void {
  response.cookies.set(COUNTRY_COOKIE, country, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

function nextWithLocaleContext(
  request: NextRequest,
  country: string,
  locale: string,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);
  requestHeaders.set(REQUEST_SEARCH_HEADER, request.nextUrl.search);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  setLocaleCookies(response, country, locale);
  return response;
}

/**
 * The same locale context, but rewriting instead of passing through.
 *
 * Under clean URLs the address the visitor holds carries no market, and the app
 * router still needs /{country}/{locale} to resolve a route. So the request is
 * rewritten inwards while the browser keeps the clean address.
 *
 * REQUEST_PATHNAME_HEADER deliberately carries the CLEAN path, not the rewritten
 * one. Anything server side that builds a link or a canonical tag from it has to
 * see the address the visitor is actually at, or the page would advertise the
 * prefixed form it was just moved away from.
 */
function rewriteWithLocaleContext(
  request: NextRequest,
  target: URL,
  country: string,
  locale: string,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);
  requestHeaders.set(REQUEST_SEARCH_HEADER, request.nextUrl.search);
  // This function is reached only from the clean-URL branch, so the pathname
  // above is already the path WITHIN the market and carries no /{country}/
  // {locale} in front of it. Saying so here is what stops the layout guessing.
  //
  // It guessed wrong, and the shape of the loss is why this header exists: a
  // visitor whose country has no Market is rewritten into it by cf-ipcountry,
  // the layout redirects them to the default market, and with the path guessed
  // away that redirect went to /ca/en, which clean URLs send on to /. Every
  // link from outside the shop's own country landed on the home page. Measured
  // on the live shop, with JavaScript off, which is how a crawler sees it.
  requestHeaders.set(REQUEST_CLEAN_URLS_HEADER, "1");

  const response = NextResponse.rewrite(target, {
    request: { headers: requestHeaders },
  });
  setLocaleCookies(response, country, locale);
  return response;
}

/**
 * The gate, as ONE function with two callers.
 *
 * It used to be written inline in the branch that handles a prefixed address,
 * which was the only branch that could reach a page. Clean URLs add a second
 * branch that can, and a gate copied into it is a gate that will drift: the two
 * copies would be edited on different days and the closed shop would be the one
 * that quietly stopped being closed.
 *
 * `prefix` is "" under clean URLs and "/{country}/{locale}" otherwise. Every
 * predicate below takes the path within the market, so "" is not a special case
 * to them, it is simply a prefix of zero length.
 *
 * Returns the bounce, or null to let the request continue.
 */
function gateBounce(opts: {
  request: NextRequest;
  pathname: string;
  prefix: string;
  requireAccount: boolean;
  publicPaths: readonly string[];
  country: string;
  locale: string;
  accessTokenCookieName: string;
  refreshTokenCookieName: string;
}): NextResponse | null {
  const { request, pathname, prefix, requireAccount, publicPaths } = opts;

  const signedIn =
    Boolean(request.cookies.get(opts.accessTokenCookieName)?.value) ||
    Boolean(request.cookies.get(opts.refreshTokenCookieName)?.value);

  // Two gates, and the wide one is checked first so its return target is the
  // page that was actually asked for rather than an account page.
  const gatedShop =
    requireAccount && !isPublicOnGatedShop(pathname, prefix, publicPaths);

  if (!signedIn && (gatedShop || isProtectedAccountPath(pathname, prefix))) {
    const loginHref = buildAccountLoginHref(
      prefix,
      `${pathname}${request.nextUrl.search}`,
      gatedShop,
    );
    const response = NextResponse.redirect(new URL(loginHref, request.nextUrl));
    setLocaleCookies(response, opts.country, opts.locale);
    return response;
  }
  return null;
}

/**
 * Creates a Next.js middleware that handles:
 * - Redirecting bare paths to /{country}/{locale}/...
 * - Detecting country from cookies → geo headers → default
 * - Detecting locale from cookies → accept-language → default
 * - Syncing spree_country / spree_locale cookies with URL segments so
 *   server-side data fetching (via `getLocaleOptions()`) uses the correct market
 */
/**
 * Map an address from Spree's Rails storefront onto this one, or nothing when the
 * address is already current.
 *
 * Deliberately a short, explicit list. A general rule would eventually rewrite
 * something that was never a legacy address, and a redirect that fires on a live
 * URL is worse than a 404: it is invisible and it moves customers.
 */
export function rewriteLegacyPath(pathname: string): string | undefined {
  if (pathname === "/contact-us") return "/contact";
  if (pathname === "/t" || pathname.startsWith("/t/")) {
    return `/c${pathname.slice(2)}`;
  }
  return undefined;
}

export function createSpreeMiddleware(
  config: SpreeMiddlewareConfig = {},
): (request: NextRequest) => NextResponse {
  const defaultCountry = config.defaultCountry ?? "us";
  const supportedLocales = config.supportedLocales ?? [];
  const configuredDefaultLocale = config.defaultLocale ?? "en";
  const defaultLocale =
    (supportedLocales.length > 0
      ? (matchLocale(configuredDefaultLocale, supportedLocales) ??
        matchLocale("en", supportedLocales) ??
        supportedLocales[0])
      : canonicalizeLocale(configuredDefaultLocale)) ?? "en";
  // Prefixes, matched with startsWith. The two that are namespaces carry their
  // slash: "/dev" alone also skipped "/development" and anything else starting
  // with those three letters, which on a closed shop is a page served without
  // an account for no better reason than its first three characters.
  const staticRoutes = config.staticRoutes ?? [
    "/_next",
    "/api/",
    "/dev/",
    "/favicon.ico",
    // The shop's own logo, favicon and social card. Gating these was a real
    // fault and a quiet one: on the closed shop the sign-in page asked for
    // /brand/logo-b2b.png and got a 307, so the one page a stranger is meant
    // to reach rendered with no logo on it. They carry no catalogue, only the
    // brand, which is on the page already.
    "/brand/",
    // The country flags, for the same reason and found the same way. He reported
    // the flag missing on his login page, his front page and his checkout, and
    // pasted the console line: 404 /b2b/en/flags/1x1/nz.svg. The file is in the
    // image at /app/public/flags/1x1/nz.svg and the retail shop serves it 200;
    // on the closed shop this middleware was prefixing it with the country and
    // locale, so the request went looking for a page that does not exist.
    //
    // 271 flags, no catalogue in any of them.
    "/flags/",
  ];
  const accessTokenCookieName =
    config.accessTokenCookieName ?? ACCESS_TOKEN_COOKIE;
  const refreshTokenCookieName =
    config.refreshTokenCookieName ?? REFRESH_TOKEN_COOKIE;
  const requireAccount = config.requireAccount ?? false;
  const cleanUrls = config.cleanUrls ?? false;
  const publicPaths = config.publicPaths ?? [];

  return function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Addresses this storefront replaced.
    //
    // Spree's own Rails storefront served categories at /t/ and the contact page
    // at /contact-us. This one serves /c/ and /contact. Without this, every
    // category address a shop had before the move answers 404, and for a shop
    // whose navigation IS its categories that is most of what search engines
    // hold. Checked against a real shop: /t/categories/... and /contact-us both
    // 404ed, while /pages/... and /policies/... came through untouched because
    // only the prefix changed for those.
    //
    // Rewritten here rather than in next.config so the visitor takes ONE hop:
    // the country and language are added by the logic below, on the already
    // corrected path.
    const legacy = rewriteLegacyPath(pathname);
    if (legacy) {
      const url = request.nextUrl.clone();
      url.pathname = legacy;
      // 308, not 307. These paths are gone for good, and a temporary redirect
      // asks search engines to keep the address that no longer exists.
      return NextResponse.redirect(url, 308);
    }

    // Skip static routes.
    //
    // startsWith, so these are prefixes and not paths: "/dev" also skips
    // "/development" and "/devious". That is deliberate for "/_next", and it is
    // why the two entries that are real namespaces carry their trailing slash
    // in the default list below.
    if (staticRoutes.some((route) => pathname.startsWith(route))) {
      return NextResponse.next();
    }

    // A file rather than a page.
    //
    // On an open shop, an address ending in an extension is something in
    // /public and is served as one. On a closed shop that shorthand is a hole:
    // a product slug may contain a dot (1.5l-drum), and /robots.txt and
    // /sitemap.xml describe every address the shop has. Both were reachable
    // without an account, which is precisely what a closed shop must not allow.
    //
    // So on a closed shop only a named handful of real assets skip, and
    // everything else goes on to the gate below. The list is short on purpose:
    // an asset wrongly gated renders as a missing icon, while a page wrongly
    // skipped renders in full to anyone holding the link.
    if (/\.\w+$/.test(pathname)) {
      if (
        !requireAccount ||
        ALWAYS_A_FILE.has(pathname) ||
        SITEMAP_SHARD.test(pathname)
      ) {
        return NextResponse.next();
      }
    }

    // A caller asking for Markdown gets Markdown.
    //
    // The client runs llms.txt and an AI-facing robots.txt, and beside them a
    // rule that hands any page over as Markdown to a caller that asks for it.
    // That rule was Rack middleware and only rewrote text/html responses, so on
    // 5.6 it had nothing to act on: Rails serves no shop pages any more. He
    // found it himself while checking AI readiness.
    //
    // Placed here deliberately, after the static skips and BEFORE the gate. A
    // closed shop must answer a Markdown request exactly the way it answers an
    // HTML one, which means the gate still runs on the rewritten request and a
    // stranger gets the sign-in page rather than the trade catalogue. Putting
    // this after the gate would have been the same mistake as serving an
    // unprefixed address without checking the account.
    if (request.method === "GET" && !pathname.startsWith("/api/markdown")) {
      const wantsMarkdown = (request.headers.get("accept") || "").includes(
        "text/markdown",
      );
      if (wantsMarkdown) {
        const url = request.nextUrl.clone();
        url.pathname = "/api/markdown";
        url.search = "";
        url.searchParams.set("path", pathname + request.nextUrl.search);
        return NextResponse.rewrite(url);
      }
    }

    // Already has /{country}/{locale} prefix — sync cookies with URL segments
    const match = matchCountryLocale(pathname, defaultCountry);
    if (match) {
      const country = match[1].toLowerCase();
      const originalPrefix = `/${match[1]}/${match[2]}`;
      const locale =
        supportedLocales.length > 0
          ? negotiateLocale(match[2], supportedLocales)
          : canonicalizeLocale(match[2]);

      // An unknown locale cannot safely retain the requested country: the
      // global default locale may not be enabled by that country's Market.
      // Use the configured default route while preserving the remaining path.
      if (!locale) {
        const url = request.nextUrl.clone();
        url.pathname = `/${defaultCountry}/${defaultLocale}${pathname.slice(originalPrefix.length)}`;
        const response = NextResponse.redirect(url);
        setLocaleCookies(response, defaultCountry, defaultLocale);
        return response;
      }

      const canonicalPrefix = `/${country}/${locale}`;

      if (originalPrefix !== canonicalPrefix) {
        const url = request.nextUrl.clone();
        url.pathname = `${canonicalPrefix}${pathname.slice(originalPrefix.length)}`;
        const response = NextResponse.redirect(url);
        setLocaleCookies(response, country, locale);
        return response;
      }

      // A prefixed address on a clean-URL shop is the old shape of a page that
      // now lives at one address. 308 rather than 307: this is permanent, and a
      // permanent redirect is what consolidates the ranking of the two forms
      // into one instead of leaving them competing.
      //
      // Redirected BEFORE the gate, on the evidence of what gating first
      // produced. It bounced a stranger to /{country}/{locale}/account carrying
      // ?redirect=/{country}/{locale}/products, so signing in landed them back
      // on the old shape and bounced them again.
      //
      // A redirect reveals nothing that is not already public, and the clean
      // address it lands on is gated by the branch at the bottom of this
      // function. So the shop is closed either way, and this way the return
      // target is the address the page actually has.
      if (cleanUrls) {
        const url = request.nextUrl.clone();
        url.pathname = pathname.slice(canonicalPrefix.length) || "/";
        const response = NextResponse.redirect(url, 308);
        setLocaleCookies(response, country, locale);
        return response;
      }

      const bounce = gateBounce({
        request,
        pathname,
        prefix: canonicalPrefix,
        requireAccount,
        publicPaths,
        country,
        locale,
        accessTokenCookieName,
        refreshTokenCookieName,
      });
      if (bounce) return bounce;

      return nextWithLocaleContext(request, country, locale);
    }

    // Detect country: cookie → geo headers → default
    const country =
      request.cookies.get(COUNTRY_COOKIE)?.value ??
      request.headers.get("x-vercel-ip-country")?.toLowerCase() ??
      request.headers.get("cf-ipcountry")?.toLowerCase() ??
      defaultCountry;

    // Detect locale: cookie → accept-language → default
    const cookieValue = request.cookies.get(LOCALE_COOKIE)?.value;
    const cookieLocale =
      supportedLocales.length > 0
        ? negotiateLocale(cookieValue, supportedLocales)
        : canonicalizeLocale(cookieValue);
    const acceptLanguage = request.headers.get("accept-language");
    const acceptedLocale =
      supportedLocales.length > 0
        ? negotiateAcceptLanguage(acceptLanguage, supportedLocales)
        : canonicalizeLocale(acceptLanguage?.split(",")[0]?.split(";")[0]);
    const locale = cookieLocale ?? acceptedLocale ?? defaultLocale;

    const url = request.nextUrl.clone();
    url.pathname = `/${country}/${locale}${pathname === "/" ? "" : pathname}`;

    // THE HAZARD, and the reason clean URLs is a flag rather than an edit.
    //
    // Before this, an address with no prefix could only ever be REDIRECTED, and
    // the gate lived in the branch above because that branch was the only one a
    // page could be served from. Clean URLs make this branch serve pages. A
    // rewrite added here without the gate would have made every address on the
    // closed shop public: the products, the trade prices, the lot, to anyone
    // holding a link. That is the exact thing the shop exists not to do, and it
    // would have looked perfect in every screenshot.
    //
    // So the gate runs here, from the same function the branch above calls, with
    // a prefix of "" because that is what the market prefix is now.
    if (cleanUrls) {
      const bounce = gateBounce({
        request,
        pathname,
        prefix: "",
        requireAccount,
        publicPaths,
        country,
        locale,
        accessTokenCookieName,
        refreshTokenCookieName,
      });
      if (bounce) return bounce;

      return rewriteWithLocaleContext(request, url, country, locale);
    }

    const response = NextResponse.redirect(url);
    setLocaleCookies(response, country, locale);
    return response;
  };
}
