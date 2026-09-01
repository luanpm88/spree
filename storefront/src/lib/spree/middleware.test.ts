import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createSpreeMiddleware } from "@/lib/spree/middleware";
import { resolveAccountRedirect } from "@/lib/utils/account-redirect";

const middleware = createSpreeMiddleware({
  defaultCountry: "us",
  defaultLocale: "en",
  supportedLocales: ["en", "de", "zh-CN"],
});

describe("Spree locale middleware", () => {
  it("canonicalizes an existing country and locale prefix", () => {
    const response = middleware(
      new NextRequest("https://store.example/US/ZH-cn/products?sort=name"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/zh-CN/products?sort=name",
    );
  });

  it("redirects an unsupported storefront locale without dropping the path", () => {
    const response = middleware(
      new NextRequest("https://store.example/ar/it/products/coffee"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/products/coffee",
    );
    expect(response.cookies.get("spree_country")?.value).toBe("us");
    expect(response.cookies.get("spree_locale")?.value).toBe("en");
  });

  it("falls back to a supported locale when the configured default is unavailable", () => {
    const invalidDefaultMiddleware = createSpreeMiddleware({
      defaultCountry: "us",
      defaultLocale: "it",
      supportedLocales: ["en", "de"],
    });

    const response = invalidDefaultMiddleware(
      new NextRequest("https://store.example/us/it/products"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/products",
    );
  });

  it("negotiates the first supported browser language", () => {
    const response = middleware(
      new NextRequest("https://store.example/products", {
        headers: { "accept-language": "it-IT, de-DE;q=0.9, en;q=0.8" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/de/products",
    );
  });

  it("uses Accept-Language quality weights instead of header order", () => {
    const response = middleware(
      new NextRequest("https://store.example/products", {
        headers: { "accept-language": "de;q=0, en-US;q=0.9" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/products",
    );
  });

  it("forwards the localized request path for Market-aware fallbacks", () => {
    const response = middleware(
      new NextRequest("https://store.example/ar/en/products/coffee?sort=price"),
    );

    expect(
      response.headers.get("x-middleware-request-x-spree-request-pathname"),
    ).toBe("/ar/en/products/coffee");
    expect(
      response.headers.get("x-middleware-request-x-spree-request-search"),
    ).toBe("?sort=price");
  });

  it("redirects an anonymous protected account request to sign in", () => {
    const response = middleware(
      new NextRequest(
        "https://store.example/us/en/account/orders?state=complete",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/account?redirect=%2Fus%2Fen%2Faccount%2Forders%3Fstate%3Dcomplete",
    );
  });

  it.each([
    "/us/en/account",
    "/us/en/account/register",
    "/us/en/account/forgot-password",
    "/us/en/account/reset-password?token=reset-token",
  ])("keeps the public account route accessible: %s", (pathname) => {
    const response = middleware(
      new NextRequest(`https://store.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    "_spree_jwt",
    "_spree_refresh_token",
  ])("allows a protected account request with a %s session cookie", (cookieName) => {
    const request = new NextRequest(
      "https://store.example/us/en/account/orders",
    );
    request.cookies.set(cookieName, "session-token");

    const response = middleware(request);

    expect(response.headers.get("location")).toBeNull();
  });

  it("does not treat an empty auth cookie as a session credential", () => {
    const request = new NextRequest(
      "https://store.example/us/en/account/orders",
    );
    request.cookies.set("_spree_jwt", "");

    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/us/en/account?");
  });
});

/**
 * The wholesale shop is closed: "No URL should be able to be seen without first
 * login in. If a user sends a URL to a friend, they should not be allowed to
 * see it until they have an account. The URLs with the bypass exception are:
 * terms-of-service, privacy-policy, returns-policy, shipping-policy."
 *
 * The four are `Spree::Policy` slugs on that shop, served at /policies/<slug>.
 */
describe("a shop that is closed to visitors without an account", () => {
  const gated = createSpreeMiddleware({
    defaultCountry: "nz",
    defaultLocale: "en",
    supportedLocales: ["en"],
    requireAccount: true,
    publicPaths: [
      "/policies/terms-of-service",
      "/policies/privacy-policy",
      "/policies/returns-policy",
      "/policies/shipping-policy",
    ],
  });

  it.each([
    "/nz/en",
    "/nz/en/products",
    "/nz/en/products/wide-mouth-800ml",
    "/nz/en/c/bottles",
    "/nz/en/cart",
    "/nz/en/contact",
    "/nz/en/pages/ordering-guide",
    "/nz/en/policies/some-other-policy",
  ])("sends a visitor with no account to the login: %s", (pathname) => {
    const response = gated(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/nz/en/account");
  });

  it("keeps the page that was asked for, so signing in does not lose it", () => {
    const response = gated(
      new NextRequest(
        "https://wholesale.example/nz/en/products/wide-mouth-800ml",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://wholesale.example/nz/en/account?redirect=%2Fnz%2Fen%2Fproducts%2Fwide-mouth-800ml",
    );
  });

  it.each([
    "/nz/en/policies/terms-of-service",
    "/nz/en/policies/privacy-policy",
    "/nz/en/policies/returns-policy",
    "/nz/en/policies/shipping-policy",
  ])("lets a business read the policy it needs to sign up: %s", (pathname) => {
    const response = gated(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    "/nz/en/account",
    "/nz/en/account/register",
    "/nz/en/account/forgot-password",
    "/nz/en/account/reset-password?token=reset-token",
  ])("leaves its own way in open: %s", (pathname) => {
    const response = gated(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("lets a signed-in wholesale customer browse", () => {
    const request = new NextRequest("https://wholesale.example/nz/en/products");
    request.cookies.set("_spree_jwt", "session-token");

    const response = gated(request);

    expect(response.headers.get("location")).toBeNull();
  });

  // Widening the return target from "account and checkout" to "any page of this
  // shop" is the part of the gate that could be got wrong, so the widening is
  // tested at its source rather than through a request: a redirect that leaves
  // the shop is the failure, and it cannot be produced by a URL the middleware
  // itself built.
  it.each([
    "https://evil.example/nz/en/products",
    "//evil.example/nz/en/products",
    "/au/en/products",
    "/nz/de/products",
    "/products",
  ])("refuses a return target that leaves this shop: %s", (target) => {
    expect(resolveAccountRedirect(target, "/nz/en", true)).toBeNull();
  });

  it("keeps a return target inside this shop, query and all", () => {
    expect(
      resolveAccountRedirect("/nz/en/products?sort=name#top", "/nz/en", true),
    ).toBe("/nz/en/products?sort=name#top");
  });

  it("carries a page's own query string into the login link", () => {
    const response = gated(
      new NextRequest("https://wholesale.example/nz/en/products?sort=name"),
    );

    expect(response.headers.get("location")).toBe(
      "https://wholesale.example/nz/en/account?redirect=%2Fnz%2Fen%2Fproducts%3Fsort%3Dname",
    );
  });

  it("ignores a trailing slash rather than treating it as a different address", () => {
    const response = gated(
      new NextRequest(
        "https://wholesale.example/nz/en/policies/privacy-policy/",
      ),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves an open shop open", () => {
    const open = createSpreeMiddleware({
      defaultCountry: "nz",
      defaultLocale: "en",
      supportedLocales: ["en"],
    });

    const response = open(
      new NextRequest("https://retail.example/nz/en/products"),
    );

    expect(response.headers.get("location")).toBeNull();
  });
});

/**
 * The bypasses an adversarial review found before this shop went up.
 *
 * Every one of them was measured against the code, not argued about, and each
 * has its request written out so a future change that reopens it fails here
 * rather than on the shop.
 */
describe("the closed shop's gate, against the ways it was got past", () => {
  const gated = createSpreeMiddleware({
    defaultCountry: "nz",
    defaultLocale: "en",
    supportedLocales: ["en"],
    requireAccount: true,
    publicPaths: ["/policies/privacy-policy"],
  });

  // The matcher in src/proxy.ts used to end `.*\..*$`, excluding every address
  // with a dot. A product slug is allowed to contain one.
  it.each([
    "/nz/en/products/1.5l-drum",
    "/nz/en/c/bottles-1.5l",
    "/nz/en/pages/about.us",
    "/nz/en/products/no.5-cap",
  ])("gates an address with a dot in it: %s", (pathname) => {
    const response = gated(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/nz/en/account");
  });

  // Gating these was worse than serving them: a 307 on /robots.txt reads to a
  // crawler as "no robots.txt", which permits everything. They reach their
  // handlers, and the handlers publish nothing. See robots.ts and sitemap.ts.
  it.each([
    "/robots.txt",
    "/sitemap.xml",
    "/sitemap/0.xml",
    "/sitemap/12.xml",
  ])("lets the crawler files answer for themselves: %s", (pathname) => {
    const response = gated(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  // The sign-in page is the one page a stranger must reach, and it asks for the
  // shop's own logo. Gating /brand/ served it a redirect instead, so the page
  // that has to work rendered without its mark on it, and the gate check passed
  // because it only ever asked for pages.
  it.each([
    "/brand/logo-b2b.png",
    "/brand/favicon-b2b.png",
    "/brand/og-b2b.jpg",
  ])("serves the shop's own brand image: %s", (pathname) => {
    const response = gated(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("still serves the browser furniture a closed shop may serve", () => {
    for (const pathname of ["/favicon.ico", "/apple-touch-icon.png"]) {
      const response = gated(
        new NextRequest(`https://wholesale.example${pathname}`),
      );
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("does not treat an address as a file just because it starts like one", () => {
    // "/dev" was a prefix, so "/development" skipped the gate on its first
    // three letters.
    const response = gated(
      new NextRequest("https://wholesale.example/nz/en/pages/development"),
    );

    expect(response.status).toBe(307);
  });

  it("leaves an open shop's file handling exactly as it was", () => {
    const open = createSpreeMiddleware({
      defaultCountry: "nz",
      defaultLocale: "en",
      supportedLocales: ["en"],
    });

    for (const pathname of [
      "/nz/en/products/1.5l-drum",
      "/robots.txt",
      "/x.png",
    ]) {
      const response = open(
        new NextRequest(`https://retail.example${pathname}`),
      );
      expect(response.headers.get("location")).toBeNull();
    }
  });
});

describe("clean URLs: no country and no locale in the address", () => {
  const clean = createSpreeMiddleware({
    defaultCountry: "nz",
    defaultLocale: "en",
    supportedLocales: ["en"],
    cleanUrls: true,
  });

  it("serves an unprefixed address in place rather than moving the visitor", () => {
    const response = clean(new NextRequest("https://retail.example/products"));

    // A rewrite, so no Location and the address in the bar does not change.
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/nz/en/products",
    );
  });

  it("sends the old prefixed address to the clean one, permanently", () => {
    const response = clean(
      new NextRequest("https://retail.example/nz/en/products?sort=name"),
    );

    // 308 and not 307. The prefixed form is not coming back, and a permanent
    // redirect is what merges the ranking of the two forms instead of leaving
    // them competing with each other.
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://retail.example/products?sort=name",
    );
  });

  it("redirects the prefixed home page to / rather than to the empty string", () => {
    const response = clean(new NextRequest("https://retail.example/nz/en"));

    expect(response.headers.get("location")).toBe("https://retail.example/");
  });

  it("still carries the locale cookies, which SSR reads to pick a market", () => {
    const response = clean(new NextRequest("https://retail.example/products"));

    expect(response.cookies.get("spree_country")?.value).toBe("nz");
    expect(response.cookies.get("spree_locale")?.value).toBe("en");
  });

  it("does not mistake a first path segment for a country", () => {
    // matchCountryLocale is built from the configured country for exactly this
    // reason. Under clean URLs every address looks like it might be a prefix.
    for (const pathname of ["/products/abc", "/pages/en", "/c/nz"]) {
      const response = clean(
        new NextRequest(`https://retail.example${pathname}`),
      );
      expect(response.headers.get("x-middleware-rewrite")).toContain(
        `/nz/en${pathname}`,
      );
    }
  });

  it("leaves the prefixed shape alone when the flag is off", () => {
    const prefixed = createSpreeMiddleware({
      defaultCountry: "nz",
      defaultLocale: "en",
      supportedLocales: ["en"],
    });

    expect(
      prefixed(new NextRequest("https://retail.example/products")).headers.get(
        "location",
      ),
    ).toBe("https://retail.example/nz/en/products");
  });
});

describe("clean URLs on the CLOSED shop, which is where this can go wrong", () => {
  // The hazard in one sentence: before clean URLs, an unprefixed address could
  // only ever be redirected, so the gate lived in the branch that handles a
  // prefixed one. Clean URLs make the unprefixed branch serve pages. A rewrite
  // added there without the gate would publish the whole trade catalogue to
  // anyone holding a link, and every screenshot would look perfect.
  const gatedClean = createSpreeMiddleware({
    defaultCountry: "nz",
    defaultLocale: "en",
    supportedLocales: ["en"],
    requireAccount: true,
    cleanUrls: true,
    publicPaths: [
      "/policies/terms-of-service",
      "/policies/privacy-policy",
      "/policies/returns-policy",
      "/policies/shipping-policy",
    ],
  });

  it.each([
    "/",
    "/products",
    "/products/1.5l-drum",
    "/c/bottles",
    "/c/bottles-1.5l",
    "/cart",
    "/checkout",
    "/pages/ordering-guide",
    "/pages/about.us",
    "/wholesale",
    "/wholesale/quick-order",
  ])("bounces a stranger off the clean address %s", (pathname) => {
    const response = gatedClean(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    // Not a rewrite. A rewrite here is the shop serving the page.
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/account");
  });

  it("keeps the page they asked for, so signing in does not lose it", () => {
    const response = gatedClean(
      new NextRequest("https://wholesale.example/products/1.5l-drum"),
    );

    expect(response.headers.get("location")).toContain(
      `redirect=${encodeURIComponent("/products/1.5l-drum")}`,
    );
  });

  it.each([
    "/policies/terms-of-service",
    "/policies/privacy-policy",
    "/policies/returns-policy",
    "/policies/shipping-policy",
  ])("still serves the four policies he named: %s", (pathname) => {
    const response = gatedClean(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.status).not.toBe(307);
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      `/nz/en${pathname}`,
    );
  });

  it.each([
    "/account",
    "/account/register",
    "/account/forgot-password",
  ])("still serves the way in: %s", (pathname) => {
    const response = gatedClean(
      new NextRequest(`https://wholesale.example${pathname}`),
    );

    expect(response.status).not.toBe(307);
  });

  it("still protects the signed-in account pages from a stranger", () => {
    const response = gatedClean(
      new NextRequest("https://wholesale.example/account/orders"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/account");
  });

  it("serves the clean address once they are signed in", () => {
    const request = new NextRequest(
      "https://wholesale.example/products/1.5l-drum",
    );
    request.cookies.set("_spree_jwt", "session-token");

    const response = gatedClean(request);

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/nz/en/products/1.5l-drum",
    );
  });

  it("does not let the OLD prefixed shape serve a page either", () => {
    // The prefixed form 308s to the clean one rather than being gated here, and
    // the clean one is gated by the branch below. So the old shape is not a way
    // round the gate; it is one hop longer. What matters is that it never
    // RENDERS: no rewrite, and the address it lands on is itself refused.
    const response = gatedClean(
      new NextRequest("https://wholesale.example/nz/en/products/1.5l-drum"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://wholesale.example/products/1.5l-drum",
    );

    // And that address, asked directly, is refused.
    const landed = gatedClean(
      new NextRequest("https://wholesale.example/products/1.5l-drum"),
    );
    expect(landed.status).toBe(307);
    expect(landed.headers.get("location")).toContain("/account");
  });

  it("still refuses the crawler files nothing should be published in", () => {
    for (const pathname of ["/robots.txt", "/sitemap.xml"]) {
      const response = gatedClean(
        new NextRequest(`https://wholesale.example${pathname}`),
      );
      // They answer for themselves, as before: the handlers publish nothing on
      // a closed shop. A 307 here would read to a crawler as "no robots.txt",
      // which permits everything.
      expect(response.headers.get("location")).toBeNull();
    }
  });
});
