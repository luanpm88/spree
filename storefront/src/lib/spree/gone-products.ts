import { type NextRequest, NextResponse } from "next/server";
import { getClient } from "./config";
import { apiLocale } from "./locale";

/**
 * A product that no longer exists answers 404, not 200.
 *
 * ── the fault ───────────────────────────────────────────────────────────────
 *
 * Search Console flagged pages on two shops as excluded by noindex. They were
 * product pages for products that had been deleted. The page knows the product
 * is gone and says so: it calls notFound(), shows the not-found text and adds
 * a noindex tag. The status line still says 200, so to a crawler the address
 * is a live page that asks not to be indexed, and it keeps coming back to it.
 *
 * ── why the page cannot fix it ──────────────────────────────────────────────
 *
 * The storefront runs with cacheComponents, so the static shell goes out with
 * its 200 before notFound() has run. Measured on a bare Next 16.2.11 app with
 * the same layout shape, 16 Nov:
 *
 *   notFound() in the page                      200 + noindex
 *   a static page that only calls notFound()    200 + noindex
 *   proxy: NextResponse.rewrite(url, {status})  200, the status is dropped
 *   proxy: NextResponse.next({status: 404})     200, the status is dropped
 *   proxy: a response with its own body         404
 *
 * resolve-routes.js keeps the proxy's status only for a redirect or for a
 * response that carries its own body. So a real 404 has to be a body the proxy
 * returns itself.
 *
 * ── what this does ──────────────────────────────────────────────────────────
 *
 * For a page request to /{country}/{locale}/products/{slug}, after the clean
 * URL rewrite, it asks the Store API the question the page is about to ask,
 * with the same country and locale. Only a 404 whose code is record_not_found
 * counts as gone. That is what the API answers for a missing product, measured
 * on the NZ shop: 404 {"error":{"code":"record_not_found"}} in 416 ms, against
 * 200 in 105 ms for a real one, and 401 invalid_token without the key.
 *
 * When the product is gone, it fetches the same address from this server with
 * a header only this process knows, so the visitor gets today's page exactly
 * (header, footer, the not-found text), and returns that page with a 404.
 *
 * ── what it never does ──────────────────────────────────────────────────────
 *
 * Anything it cannot be sure of lets the request through unchanged: a timeout,
 * a network error, a 5xx, a 401 after a key change, a 404 without
 * record_not_found (a wrong API address would answer that for every product),
 * an internal render that fails, or a rendered page that does not itself say
 * noindex. Those requests behave exactly as they did before this existed, so
 * the worst outcome is today's 200, never a 404 on a product that is for sale.
 *
 * Only page loads are checked. A client-side navigation or a prefetch fetches
 * the RSC payload, and answering that with an HTML page would be wrong; a
 * crawler never sends one.
 */

export type Verdict = "found" | "gone" | "unknown";

export interface ProductRoute {
  country: string;
  locale: string;
  slug: string;
}

export interface GoneProductOptions {
  /** Off on a shop that requires an account: a crawler only ever reaches its sign-in page. */
  enabled: boolean;
  lookup?: (route: ProductRoute) => Promise<Verdict>;
  render?: (request: NextRequest, headers: Headers) => Promise<Response>;
  now?: () => number;
}

export const BYPASS_HEADER = "x-storefront-gone-check";

// Per process, so nobody outside can set it. All it does is skip this check,
// which returns today's page, but a switch a stranger can flip is still a
// switch nobody needs to reason about.
const BYPASS_SECRET = globalThis.crypto.randomUUID();

// A product that exists stays existing far more often than not, so that
// answer is kept longest. A gone one is kept briefly, so a product that comes
// back is a 200 again within minutes.
const FOUND_TTL_MS = 30 * 60_000;
const GONE_TTL_MS = 5 * 60_000;
// Bounded, because these containers already run close to their heap
// (DISCOVERIES 93). A thousand short keys is a few hundred kilobytes.
const MAX_ENTRIES = 1000;
const LOOKUP_TIMEOUT_MS = 2000;
const RENDER_TIMEOUT_MS = 8000;

// Headers the internal render needs so it renders what the visitor would get:
// their cookies (cart, sign-in, market) and the headers that pick a market.
// An allowlist rather than a copy, so nothing that steers Next internally
// (x-middleware-*, rsc, next-*) can be carried into the second request.
const FORWARDED = [
  "accept",
  "accept-language",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cookie",
  "referer",
  "user-agent",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
  "x-vercel-ip-country",
];

/**
 * The product a request will render, or null when it will not render one.
 *
 * Read from the response the locale middleware produced, because that is where
 * the clean-URL rewrite is: /products/x on a clean-URL shop becomes
 * /nz/en/products/x only inside it. A redirect, a sign-in bounce or a response
 * with its own body renders no product, so it gets null.
 */
export function productRouteOf(
  request: NextRequest,
  response: NextResponse,
): ProductRoute | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  // Not a page load: a client-side navigation or a prefetch.
  //
  // The obvious test, the rsc header, cannot work here. Next deletes rsc,
  // next-router-state-tree and next-router-prefetch from the request before
  // the proxy runs (FLIGHT_HEADERS in next/dist/server/web/adapter.js) and
  // takes _rsc off the address, then puts them back for the render. Measured
  // on a built app: a request carrying rsc: 1 for a gone product reached this
  // check and was answered with HTML, where a product that exists got
  // text/x-component. What a browser does mark is its own fetch():
  // Sec-Fetch-Dest is "empty" for that and "document" for a page load, and a
  // crawler sends no Sec-Fetch headers at all.
  const dest = request.headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return null;

  let pathname: string;
  const rewrite = response.headers.get("x-middleware-rewrite");
  if (rewrite) {
    try {
      pathname = new URL(rewrite, request.nextUrl).pathname;
    } catch {
      return null;
    }
  } else if (response.headers.get("x-middleware-next")) {
    pathname = request.nextUrl.pathname;
  } else {
    return null;
  }

  const parts = pathname.split("/");
  // "", country, locale, "products", slug, and nothing after it
  if (parts.length !== 5 || parts[0] !== "" || parts[3] !== "products") {
    return null;
  }
  const [, country, locale, , rawSlug] = parts;
  if (!country || !locale || !rawSlug) return null;

  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    return null;
  }
  return { country: country.toLowerCase(), locale, slug };
}

/** True when the HTML carries a robots meta tag that says noindex. */
export function saysNoindex(html: string): boolean {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/\bname=["']?robots["']?/i.test(tag) && /noindex/i.test(tag)) {
      return true;
    }
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Asks exactly what the product page asks: same client, same country, same locale. */
async function lookupProduct(route: ProductRoute): Promise<Verdict> {
  try {
    await withTimeout(
      getClient().products.get(route.slug, undefined, {
        locale: apiLocale(route.locale),
        country: route.country,
      }),
      LOOKUP_TIMEOUT_MS,
    );
    return "found";
  } catch (error) {
    const e = error as { status?: unknown; code?: unknown } | null;
    if (e?.status === 404 && e?.code === "record_not_found") return "gone";
    return "unknown";
  }
}

async function renderHere(
  request: NextRequest,
  headers: Headers,
): Promise<Response> {
  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}${request.nextUrl.pathname}${request.nextUrl.search}`;
  return fetch(url, {
    headers,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });
}

export function createGoneProductCheck(options: GoneProductOptions) {
  const lookup = options.lookup ?? lookupProduct;
  const render = options.render ?? renderHere;
  const now = options.now ?? Date.now;
  const known = new Map<string, { verdict: Verdict; at: number }>();
  const asking = new Map<string, Promise<Verdict>>();

  function remember(key: string, verdict: Verdict): void {
    if (verdict === "unknown") return;
    known.delete(key);
    known.set(key, { verdict, at: now() });
    while (known.size > MAX_ENTRIES) {
      const oldest = known.keys().next().value;
      if (oldest === undefined) break;
      known.delete(oldest);
    }
  }

  async function verdictFor(route: ProductRoute): Promise<Verdict> {
    const key = `${route.country}|${route.locale}|${route.slug}`;
    const hit = known.get(key);
    if (hit) {
      const ttl = hit.verdict === "found" ? FOUND_TTL_MS : GONE_TTL_MS;
      if (now() - hit.at < ttl) return hit.verdict;
      known.delete(key);
    }
    const pending = asking.get(key);
    if (pending) return pending;

    const question = lookup(route)
      .catch((): Verdict => "unknown")
      .then((verdict) => {
        remember(key, verdict);
        return verdict;
      })
      .finally(() => asking.delete(key));
    asking.set(key, question);
    return question;
  }

  function copyCookies(from: NextResponse, to: NextResponse): void {
    for (const cookie of from.headers.getSetCookie()) {
      to.headers.append("set-cookie", cookie);
    }
  }

  async function notFoundPage(
    request: NextRequest,
    response: NextResponse,
  ): Promise<NextResponse | null> {
    const headers = {
      "cache-control":
        "private, no-cache, no-store, max-age=0, must-revalidate",
    };
    if (request.method === "HEAD") {
      const head = new NextResponse(null, {
        status: 404,
        headers: { ...headers, "content-type": "text/html; charset=utf-8" },
      });
      copyCookies(response, head);
      return head;
    }

    const forward = new Headers();
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value) forward.set(name, value);
    }
    const host = request.headers.get("host");
    if (host) forward.set("x-forwarded-host", host);
    forward.set(BYPASS_HEADER, BYPASS_SECRET);

    try {
      const page = await render(request, forward);
      const type = page.headers.get("content-type") ?? "";
      if (page.status !== 200 || !type.includes("text/html")) return null;
      const html = await page.text();
      // The page has to agree. If it rendered a product after all (it came
      // back between the two questions), let the normal request serve it.
      if (!saysNoindex(html)) return null;

      const gone = new NextResponse(html, {
        status: 404,
        headers: { ...headers, "content-type": type },
      });
      copyCookies(response, gone);
      return gone;
    } catch {
      return null;
    }
  }

  return async function goneProduct(
    request: NextRequest,
    response: NextResponse,
  ): Promise<NextResponse> {
    if (!options.enabled) return response;
    // The internal render of a page this check already judged.
    if (request.headers.get(BYPASS_HEADER) === BYPASS_SECRET) return response;

    const route = productRouteOf(request, response);
    if (!route) return response;
    if ((await verdictFor(route)) !== "gone") return response;
    return (await notFoundPage(request, response)) ?? response;
  };
}
